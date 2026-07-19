#Requires -Version 5.1
param(
    [switch]$SkipInstall,
    [switch]$NoBrowser,
    [ValidateRange(1024, 65535)][int]$BackendPort = 8000,
    [ValidateRange(1024, 65535)][int]$FrontendPort = 5173
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ScriptDir 'backend'
$FrontendDir = Join-Path $ScriptDir 'frontend'
$HarvestDir = Join-Path $ScriptDir 'harvested_kernels'
$BackendLog = Join-Path $ScriptDir 'backend.log'
$BackendErrorLog = Join-Path $ScriptDir 'backend-error.log'
$FrontendLog = Join-Path $ScriptDir 'frontend.log'
$FrontendErrorLog = Join-Path $ScriptDir 'frontend-error.log'

function Test-LocalPort {
    param([int]$Port)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        return $task.Wait(300) -and $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-ForHealth {
    param([string]$Uri, [int]$Attempts = 30)
    foreach ($attempt in 1..$Attempts) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return $true
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId $child.ProcessId
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Test-ProcessRunning {
    param([int]$ProcessId)
    return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

Write-Host ''
Write-Host 'Kaggle Harvester' -ForegroundColor Cyan
Write-Host 'Checking local environment...' -ForegroundColor DarkGray

$PythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $PythonCommand) {
    throw 'Python was not found. Install Python 3.11 or newer.'
}
$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCommand) {
    throw 'npm was not found. Install Node.js first.'
}

if (Test-LocalPort $BackendPort) {
    throw "Backend port $BackendPort is already in use. Stop the existing service or pass -BackendPort."
}
if (Test-LocalPort $FrontendPort) {
    throw "Frontend port $FrontendPort is already in use. Stop the existing service or pass -FrontendPort."
}

$EnvFile = Join-Path $BackendDir '.env'
if (-not $env:KAGGLE_API_TOKEN -and (Test-Path $EnvFile)) {
    foreach ($line in Get-Content -Encoding UTF8 $EnvFile) {
        if ($line -match '^\s*KAGGLE_API_TOKEN\s*=\s*["'']?(.+?)["'']?\s*$') {
            $env:KAGGLE_API_TOKEN = $matches[1]
            break
        }
    }
}

if (-not (Test-Path $HarvestDir)) {
    New-Item -ItemType Directory -Path $HarvestDir -Force | Out-Null
}

if (-not $SkipInstall) {
    & $PythonCommand.Source -c 'import fastapi, httpx, kaggle, pydantic, uvicorn' 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Installing backend dependencies...' -ForegroundColor Yellow
        & $PythonCommand.Source -m pip install -r (Join-Path $BackendDir 'requirements.txt') -q
        if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
    }

    if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
        Write-Host 'Installing frontend dependencies...' -ForegroundColor Yellow
        Push-Location $FrontendDir
        try {
            & $NpmCommand.Source ci --silent
            if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
        }
        finally {
            Pop-Location
        }
    }
}

if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
    throw 'Frontend dependencies are missing. Start again without -SkipInstall.'
}

foreach ($log in @($BackendLog, $BackendErrorLog, $FrontendLog, $FrontendErrorLog)) {
    if (Test-Path $log) { Remove-Item -LiteralPath $log -Force }
}

$env:PORT = [string]$BackendPort
$env:HOST = '127.0.0.1'
$env:HARVEST_ROOT = $HarvestDir
$BackendServicePid = $null
$FrontendServicePid = $null
$BackendProcess = Start-Process `
    -FilePath $PythonCommand.Source `
    -ArgumentList 'main.py' `
    -WorkingDirectory $BackendDir `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $BackendLog `
    -RedirectStandardError $BackendErrorLog

$BackendHealthUrl = "http://127.0.0.1:$BackendPort/api/health"
if (-not (Wait-ForHealth -Uri $BackendHealthUrl)) {
    if (-not $BackendProcess.HasExited) { Stop-Process -Id $BackendProcess.Id -Force }
    $details = if (Test-Path $BackendErrorLog) {
        (Get-Content -Encoding UTF8 $BackendErrorLog -Tail 20) -join [Environment]::NewLine
    } else { 'The backend produced no error log.' }
    throw "Backend startup failed: $details"
}
$BackendServicePid = (Get-NetTCPConnection -State Listen -LocalPort $BackendPort).OwningProcess

$env:VITE_API_TARGET = "http://127.0.0.1:$BackendPort"
$FrontendProcess = Start-Process `
    -FilePath $NpmCommand.Source `
    -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', [string]$FrontendPort, '--strictPort') `
    -WorkingDirectory $FrontendDir `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $FrontendLog `
    -RedirectStandardError $FrontendErrorLog

$FrontendUrl = "http://127.0.0.1:$FrontendPort"
if (-not (Wait-ForHealth -Uri $FrontendUrl)) {
    if (-not $FrontendProcess.HasExited) { Stop-Process -Id $FrontendProcess.Id -Force }
    if (-not $BackendProcess.HasExited) { Stop-Process -Id $BackendProcess.Id -Force }
    $details = if (Test-Path $FrontendErrorLog) {
        (Get-Content -Encoding UTF8 $FrontendErrorLog -Tail 20) -join [Environment]::NewLine
    } else { 'The frontend produced no error log.' }
    throw "Frontend startup failed: $details"
}
$FrontendServicePid = (Get-NetTCPConnection -State Listen -LocalPort $FrontendPort).OwningProcess

Write-Host ''
Write-Host 'Services are ready' -ForegroundColor Green
Write-Host "  App       $FrontendUrl" -ForegroundColor White
Write-Host "  API docs  http://127.0.0.1:$BackendPort/docs" -ForegroundColor White
Write-Host "  Archives  $HarvestDir" -ForegroundColor White
if (-not $env:KAGGLE_API_TOKEN) {
    Write-Host '  Notice    KAGGLE_API_TOKEN is not set; public score lookup may be unavailable.' -ForegroundColor Yellow
}
Write-Host ''
Write-Host 'Press Ctrl+C to stop both services.' -ForegroundColor DarkGray

if (-not $NoBrowser) {
    Start-Process $FrontendUrl | Out-Null
}

try {
    while (
        (Test-ProcessRunning -ProcessId $BackendServicePid) -and
        (Test-ProcessRunning -ProcessId $FrontendServicePid)
    ) {
        Start-Sleep -Seconds 2
    }
    if (-not (Test-ProcessRunning -ProcessId $BackendServicePid)) {
        Write-Host 'The backend exited unexpectedly. Check backend-error.log.' -ForegroundColor Red
    }
    if (-not (Test-ProcessRunning -ProcessId $FrontendServicePid)) {
        Write-Host 'The frontend exited unexpectedly. Check frontend-error.log.' -ForegroundColor Red
    }
}
finally {
    Write-Host ''
    Write-Host 'Stopping services...' -ForegroundColor Yellow
    foreach ($processId in @($FrontendServicePid, $BackendServicePid)) {
        if ($processId -and (Test-ProcessRunning -ProcessId $processId)) {
            Stop-ProcessTree -ProcessId $processId
        }
    }
    Write-Host 'Services stopped.' -ForegroundColor Green
}
