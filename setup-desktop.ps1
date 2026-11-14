param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$desktopLink = Join-Path $desktop 'Startup Signal.lnk'
$startupLink = Join-Path $startup 'Startup Signal.lnk'

if ($Uninstall) {
    Remove-Item -LiteralPath $desktopLink -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $startupLink -Force -ErrorAction SilentlyContinue
    Write-Host 'Removed the Startup Signal desktop and sign-in shortcuts.'
    exit
}

$executable = Join-Path $appDir 'StartupSignal.exe'
if (-not (Test-Path $executable)) { throw 'StartupSignal.exe was not found. Run build-desktop.ps1 first.' }
$null = New-Item -ItemType Directory -Path $desktop -Force
$null = New-Item -ItemType Directory -Path $startup -Force
$shell = New-Object -ComObject WScript.Shell
foreach ($linkPath in @($desktopLink, $startupLink)) {
    $shortcut = $shell.CreateShortcut($linkPath)
    $shortcut.TargetPath = $executable
    if ($linkPath -eq $startupLink) { $shortcut.Arguments = '--background' } else { $shortcut.Arguments = '' }
    $shortcut.WorkingDirectory = $appDir
    $shortcut.Description = 'Startup Signal scans for startup jobs and hides to the notification area when closed.'
    $shortcut.IconLocation = $executable
    $shortcut.Save()
}
Write-Host 'Installed Startup Signal shortcuts on the Desktop and in the Windows sign-in Startup folder.'
Write-Host 'Clicking X hides the app in the tray; use Exit Startup Signal in its tray menu to stop scanning.'
