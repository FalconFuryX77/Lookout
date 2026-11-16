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

if (-not $SkipBuild) { & (Join-Path $root 'build-desktop.ps1') }

# 1. Stage exactly what a user needs: the app, the scanner and the UI. Never anyone's data.
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
$null = New-Item -ItemType Directory -Path (Join-Path $stage 'desktop') -Force
$files = 'Lookout.exe', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll', 'server.mjs', 'package.json', 'README.md', 'setup-desktop.ps1'
foreach ($f in $files) { Copy-Item (Join-Path $root $f) $stage }
Copy-Item (Join-Path $root 'src') $stage -Recurse
Copy-Item (Join-Path $root 'public') $stage -Recurse
Copy-Item (Join-Path $root 'desktop\lookout.ico') (Join-Path $stage 'desktop')

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
Write-Host "Built $zip ($([math]::Round((Get-Item $zip).Length / 1KB)) KB)."
