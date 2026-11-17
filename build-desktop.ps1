# Builds Lookout.exe (next to this script, or at -Out).
param([string]$Out)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Out) { $Out = Join-Path $root 'Lookout.exe' }
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
if (-not (Test-Path (Join-Path $framework 'csc.exe'))) { $framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319' }
$compiler = Join-Path $framework 'csc.exe'

# The WebView2 DLLs that ship next to Lookout.exe are also what we compile against.
# If any are missing, pull them out of webview2.nupkg (a NuGet package is a zip) when it's present.
$needed = @{ 'Microsoft.Web.WebView2.Core.dll' = 'lib/net462/'; 'Microsoft.Web.WebView2.WinForms.dll' = 'lib/net462/'; 'WebView2Loader.dll' = 'runtimes/win-x64/native/' }
$missing = $needed.Keys | Where-Object { -not (Test-Path (Join-Path $root $_)) }
if ($missing) {
    $pkg = Join-Path $root 'webview2.nupkg'
    if (-not (Test-Path $pkg)) { throw "Missing $($missing -join ', ') and no webview2.nupkg to extract them from. Download Microsoft.Web.WebView2 from nuget.org as webview2.nupkg into this folder." }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($pkg)
    try { foreach ($f in $missing) { $entry = $zip.GetEntry($needed[$f] + $f); [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $root $f), $true) } }
    finally { $zip.Dispose() }
}

$arguments = @(
    '/nologo', '/target:winexe', '/optimize+', "/out:$Out", "/win32icon:$(Join-Path $root 'desktop\lookout.ico')",
    "/reference:$(Join-Path $framework 'System.dll')",
    "/reference:$(Join-Path $framework 'System.Core.dll')",
    "/reference:$(Join-Path $framework 'System.Drawing.dll')",
    "/reference:$(Join-Path $framework 'System.Windows.Forms.dll')",
    "/reference:$(Join-Path $root 'Microsoft.Web.WebView2.Core.dll')",
    "/reference:$(Join-Path $root 'Microsoft.Web.WebView2.WinForms.dll')",
    (Join-Path $root 'desktop\Lookout.cs')
)
& $compiler $arguments
if ($LASTEXITCODE -ne 0) { throw "Lookout desktop build failed with exit code $LASTEXITCODE." }
Write-Host "Built $Out."
