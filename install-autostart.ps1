#Requires -Version 5.1
param(
    [switch]$Uninstall,
    [ValidateRange(1024, 65535)][int]$BackendPort = 8000,
    [ValidateRange(1024, 65535)][int]$FrontendPort = 5173
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'Kaggle Harvester Local Service'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $ScriptDir 'start.ps1'

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task: $TaskName" -ForegroundColor Green
    }
    else {
        Write-Host 'The scheduled task does not exist.' -ForegroundColor Yellow
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $StartScript)) {
    throw "Start script not found: $StartScript"
}

$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$Arguments = @(
    '-NoProfile'
    '-ExecutionPolicy Bypass'
    '-WindowStyle Hidden'
    "-File `"$StartScript`""
    '-SkipInstall'
    '-NoBrowser'
    "-BackendPort $BackendPort"
    "-FrontendPort $FrontendPort"
) -join ' '

$Action = New-ScheduledTaskAction `
    -Execute $PowerShell `
    -Argument $Arguments `
    -WorkingDirectory $ScriptDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Settings $Settings `
    -Description 'Run Kaggle Harvester after logon and restart it after failures.' `
    -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName" -ForegroundColor Green
Write-Host 'It will run after logon and restart after failures.' -ForegroundColor DarkGray
Write-Host 'To remove it: .\install-autostart.ps1 -Uninstall' -ForegroundColor DarkGray
