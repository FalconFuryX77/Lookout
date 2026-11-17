# Builds the Windows download: dist\Lookout-windows.zip, with Lookout.exe code-signed when a certificate is given.
#
#   .\release.ps1                                   unsigned build
#   .\release.ps1 -Thumbprint <cert thumbprint>     signed with a certificate in your Windows certificate store
#                                                   (a cloud certificate such as Certum SimplySign appears there
#                                                   while its desktop app is connected)
#   .\release.ps1 -PfxPath .\my-cert.pfx            signed with a certificate file; asks for its password
#
# Only Lookout.exe is signed: the three WebView2 DLLs that ship beside it are already signed by Microsoft.
# A signature is timestamped, so it stays valid after the certificate itself expires.
param(
    [string]$Thumbprint,
    [string]$PfxPath,
    [string]$TimestampServer = 'http://time.certum.pl',
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'Lookout'

# Built outside the folder, so a running Lookout.exe (which Windows keeps locked) does not stop a release.
$built = Join-Path ([IO.Path]::GetTempPath()) 'lookout-build\Lookout.exe'
if (-not $SkipBuild) { $null = New-Item -ItemType Directory -Path (Split-Path $built) -Force; & (Join-Path $root 'build-desktop.ps1') -Out $built }

# 1. Stage exactly what a user needs: the app, the scanner and the UI. Never anyone's data.
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
$null = New-Item -ItemType Directory -Path (Join-Path $stage 'desktop') -Force
$files = 'Lookout.exe', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll', 'server.mjs', 'package.json', 'README.md', 'LICENSE', 'setup-desktop.ps1'
foreach ($f in $files) { Copy-Item (Join-Path $root $f) $stage }
if (-not $SkipBuild) { Copy-Item $built (Join-Path $stage 'Lookout.exe') -Force }
Copy-Item (Join-Path $root 'src') $stage -Recurse
# the extension uses the same skill code as the app: refresh its copy first
& node (Join-Path $root 'extension\sync-shared.mjs')
Copy-Item (Join-Path $root 'public') $stage -Recurse
Copy-Item (Join-Path $root 'extension') $stage -Recurse
$null = New-Item -ItemType Directory -Path (Join-Path $stage 'starter') -Force
Copy-Item (Join-Path $root 'starter\sources.json') (Join-Path $stage 'starter')
Copy-Item (Join-Path $root 'starter\vocab.json') (Join-Path $stage 'starter')
Copy-Item (Join-Path $root 'desktop\lookout.ico') (Join-Path $stage 'desktop')

# The Node.js this was built and tested with goes in runtime\, so the download needs nothing installed.
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$null = New-Item -ItemType Directory -Path (Join-Path $stage 'runtime') -Force
Copy-Item $nodeExe (Join-Path $stage 'runtime\node.exe')
# Node.js's licence (MIT, plus the licences of what it includes) travels with it, for the exact version bundled.
$nodeVersion = (& $nodeExe --version).Trim()
$nodeLicense = Join-Path (Split-Path $nodeExe) 'LICENSE'
if (Test-Path $nodeLicense) { Copy-Item $nodeLicense (Join-Path $stage 'runtime\LICENSE.node.txt') }
else { Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile (Join-Path $stage 'runtime\LICENSE.node.txt') }
Write-Host "Bundled Node.js $nodeVersion from $nodeExe."

# 2. Sign
$cert = $null
if ($Thumbprint) {
    $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -CodeSigningCert | Where-Object Thumbprint -eq ($Thumbprint -replace '\s', '').ToUpper() | Select-Object -First 1
    if (-not $cert) { throw "No code-signing certificate with thumbprint $Thumbprint in your certificate store." }
} elseif ($PfxPath) {
    $password = Read-Host -AsSecureString "Password for $PfxPath"
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path $PfxPath).Path, $password, 'DefaultKeySet')
}
$exe = Join-Path $stage 'Lookout.exe'
if ($cert) {
    $sign = @{ FilePath = $exe; Certificate = $cert; HashAlgorithm = 'SHA256' }
    if ($TimestampServer) { $sign.TimestampServer = $TimestampServer }
    $result = Set-AuthenticodeSignature @sign
    if (-not $result.SignerCertificate) { throw "Signing failed: $($result.StatusMessage)" }
    $check = Get-AuthenticodeSignature $exe
    Write-Host "Signed Lookout.exe as '$($check.SignerCertificate.Subject)'. Windows says: $($check.Status)."
    if ($check.Status -ne 'Valid') { Write-Warning 'The signature is not trusted on this computer. A certificate from a public certificate authority is needed for downloads to show your name.' }
} else {
    Write-Host 'No certificate given: Lookout.exe is not signed. Windows will show "Windows protected your PC" on first run.'
}

# 3. Zip
$zip = Join-Path $dist 'Lookout-windows.zip'
Compress-Archive -Path $stage -DestinationPath $zip -Force
# the extension on its own, ready for the Chrome Web Store or Edge Add-ons
$extZip = Join-Path $dist 'Lookout-extension.zip'
Compress-Archive -Path (Join-Path $root 'extension\*') -DestinationPath $extZip -Force
Write-Host "Built $extZip."
Write-Host "Built $zip ($([math]::Round((Get-Item $zip).Length / 1KB)) KB)."
# Checksums, attached to the release, so anyone can check a download is exactly what was built.
$sums = Get-ChildItem $dist -File -Filter *.zip | Sort-Object Name | ForEach-Object { "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name }
Set-Content -Path (Join-Path $dist 'SHA256SUMS.txt') -Value $sums -Encoding ascii
Write-Host "Wrote SHA256SUMS.txt."
