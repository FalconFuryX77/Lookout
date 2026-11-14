param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$desktopLink = Join-Path $desktop 'Lookout.lnk'
$startupLink = Join-Path $startup 'Lookout.lnk'
# Shortcuts left by the app's previous name
$legacyLinks = @((Join-Path $desktop 'Startup Signal.lnk'), (Join-Path $startup 'Startup Signal.lnk'))

if ($Uninstall) {
    foreach ($l in @($desktopLink, $startupLink) + $legacyLinks) { Remove-Item -LiteralPath $l -Force -ErrorAction SilentlyContinue }
    Write-Host 'Removed the Lookout desktop and sign-in shortcuts.'
    exit
}

$executable = Join-Path $appDir 'Lookout.exe'
if (-not (Test-Path $executable)) { throw 'Lookout.exe was not found. Run build-desktop.ps1 first.' }
foreach ($l in $legacyLinks) { Remove-Item -LiteralPath $l -Force -ErrorAction SilentlyContinue }
$null = New-Item -ItemType Directory -Path $desktop -Force
$null = New-Item -ItemType Directory -Path $startup -Force
$shell = New-Object -ComObject WScript.Shell
foreach ($linkPath in @($desktopLink, $startupLink)) {
    $shortcut = $shell.CreateShortcut($linkPath)
    $shortcut.TargetPath = $executable
    if ($linkPath -eq $startupLink) { $shortcut.Arguments = '--background' } else { $shortcut.Arguments = '' }
    $shortcut.WorkingDirectory = $appDir
    $shortcut.Description = 'Lookout scans for startup jobs and hides to the notification area when closed.'
    $shortcut.IconLocation = "$executable,0"
    $shortcut.Save()
}
Write-Host 'Installed Lookout shortcuts on the Desktop and in the Windows sign-in Startup folder.'
Write-Host 'Clicking X hides the app in the tray; use Exit Lookout in its tray menu to stop scanning.'
