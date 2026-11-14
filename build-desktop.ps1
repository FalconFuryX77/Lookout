$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$sdk = Join-Path $root 'webview2-sdk'
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
if (-not (Test-Path (Join-Path $framework 'csc.exe'))) { $framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319' }
$compiler = Join-Path $framework 'csc.exe'
$lib = Join-Path $sdk 'lib\net462'
$native = Join-Path $sdk 'runtimes\win-x64\native'
foreach ($file in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')) {
    $destination = Join-Path $root $file
    if (-not (Test-Path $destination)) { Copy-Item -LiteralPath (Join-Path $lib $file) -Destination $destination -Force }
}
$loader = Join-Path $root 'WebView2Loader.dll'
if (-not (Test-Path $loader)) { Copy-Item -LiteralPath (Join-Path $native 'WebView2Loader.dll') -Destination $loader -Force }
$arguments = @(
    '/nologo', '/target:winexe', '/optimize+', "/out:$(Join-Path $root 'Lookout.exe')", "/win32icon:$(Join-Path $root 'desktop\lookout.ico')",
    "/reference:$(Join-Path $framework 'System.dll')",
    "/reference:$(Join-Path $framework 'System.Core.dll')",
    "/reference:$(Join-Path $framework 'System.Drawing.dll')",
    "/reference:$(Join-Path $framework 'System.Windows.Forms.dll')",
    "/reference:$(Join-Path $lib 'Microsoft.Web.WebView2.Core.dll')",
    "/reference:$(Join-Path $lib 'Microsoft.Web.WebView2.WinForms.dll')",
    (Join-Path $root 'desktop\Lookout.cs')
)
& $compiler $arguments
if ($LASTEXITCODE -ne 0) { throw "Lookout desktop build failed with exit code $LASTEXITCODE." }
Write-Host 'Built Lookout.exe with the Microsoft WebView2 WinForms SDK.'
