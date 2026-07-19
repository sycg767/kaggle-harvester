#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$FrontendDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$MockPort = 18000
$FrontendPort = 15173
$TempBase = [IO.Path]::GetFullPath($env:TEMP)
$TempRoot = [IO.Path]::GetFullPath((Join-Path $TempBase "kaggle-harvester-e2e-$PID"))
if (-not $TempRoot.StartsWith($TempBase, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Temporary path validation failed.'
}
New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null

function Stop-ProcessTree {
    param([int]$ProcessId)
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) { Stop-ProcessTree -ProcessId $child.ProcessId }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Wait-Http {
    param([string]$Uri)
    foreach ($attempt in 1..40) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        }
        catch { Start-Sleep -Milliseconds 250 }
    }
    throw "Service did not become ready: $Uri"
}

$EdgeCandidates = @(
    "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$Edge = $EdgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $Edge) { throw 'Microsoft Edge was not found.' }

$MockProcess = $null
$FrontendProcess = $null
try {
    $MockProcess = Start-Process -FilePath (Get-Command node).Source `
        -ArgumentList 'tests/mock-api.mjs' -WorkingDirectory $FrontendDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $TempRoot 'mock.log') -RedirectStandardError (Join-Path $TempRoot 'mock-error.log')
    Wait-Http -Uri "http://127.0.0.1:$MockPort/api/health"

    $env:VITE_API_TARGET = "http://127.0.0.1:$MockPort"
    $FrontendProcess = Start-Process -FilePath (Get-Command npm.cmd).Source `
        -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', [string]$FrontendPort, '--strictPort') `
        -WorkingDirectory $FrontendDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $TempRoot 'frontend.log') -RedirectStandardError (Join-Path $TempRoot 'frontend-error.log')
    Wait-Http -Uri "http://127.0.0.1:$FrontendPort"

    $DomPath = Join-Path $TempRoot 'dom.html'
    $EdgeErrorPath = Join-Path $TempRoot 'edge-error.log'
    $EdgeProfile = Join-Path $TempRoot 'edge-profile'
    $EdgeProcess = Start-Process -FilePath $Edge `
        -ArgumentList @('--headless=new', '--disable-gpu', '--no-first-run', '--virtual-time-budget=5000', "--user-data-dir=$EdgeProfile", '--dump-dom', "http://127.0.0.1:$FrontendPort/kernels") `
        -Wait -PassThru -RedirectStandardOutput $DomPath -RedirectStandardError $EdgeErrorPath
    if ($EdgeProcess.ExitCode -ne 0) { throw "Edge exited with code $($EdgeProcess.ExitCode)." }
    $Dom = Get-Content -Raw -Encoding UTF8 $DomPath
    foreach ($Expected in @('newapi-app', 'owner/example-notebook', '6.9390')) {
        if (-not $Dom.Contains($Expected)) { throw "UI smoke assertion failed: $Expected" }
    }
    Write-Host 'UI smoke test passed.' -ForegroundColor Green
}
finally {
    foreach ($process in @($FrontendProcess, $MockProcess)) {
        if ($process -and -not $process.HasExited) { Stop-ProcessTree -ProcessId $process.Id }
    }
    if (Test-Path -LiteralPath $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force }
}
