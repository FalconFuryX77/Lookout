# Draws the Lookout radar logo (same design as public/logo.svg) into desktop\lookout.ico
# with 16/24/32/48/64/128/256 px images, so Windows has a crisp icon at every size.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$out = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'lookout.ico'

function Draw-Logo([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.Clear([System.Drawing.Color]::Transparent)
    $k = $size / 64.0
    $S = { param($v) [single]($v * $k) }

    # rounded background with a diagonal navy gradient
    $r = & $S 16; $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, 2*$r, 2*$r, 180, 90); $path.AddArc($size-2*$r, 0, 2*$r, 2*$r, 270, 90)
    $path.AddArc($size-2*$r, $size-2*$r, 2*$r, 2*$r, 0, 90); $path.AddArc(0, $size-2*$r, 2*$r, 2*$r, 90, 90); $path.CloseFigure()
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.PointF]::new(0,0)), ([System.Drawing.PointF]::new($size,$size)), ([System.Drawing.Color]::FromArgb(255,0x1B,0x1F,0x3B)), ([System.Drawing.Color]::FromArgb(255,0x0D,0x10,0x24))
    $g.FillPath($bg, $path)

    $lime = [System.Drawing.Color]::FromArgb(255, 0xC6, 0xF4, 0x32)
    $cx = & $S 30; $cy = & $S 34
    $w = [Math]::Max(1.2, (& $S 2))
    # radar rings
    $g.DrawEllipse((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, $lime)), $w), $cx-(& $S 20), $cy-(& $S 20), (& $S 40), (& $S 40))
    $g.DrawEllipse((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(110, $lime)), $w), $cx-(& $S 12), $cy-(& $S 12), (& $S 24), (& $S 24))
    # sweep wedge (from 12 o'clock to ~67°) and its leading edge
    $wedge = New-Object System.Drawing.Drawing2D.GraphicsPath
    $wedge.AddPie($cx-(& $S 20), $cy-(& $S 20), (& $S 40), (& $S 40), -90, 67)
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(95, $lime))), $wedge)
    $edge = New-Object System.Drawing.Pen $lime, ([Math]::Max(1.4, (& $S 2.5))); $edge.StartCap = 'Round'; $edge.EndCap = 'Round'
    $g.DrawLine($edge, $cx, $cy, (& $S 48.4), (& $S 26.2))
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $lime), $cx-(& $S 3.2), $cy-(& $S 3.2), (& $S 6.4), (& $S 6.4))
    # the signal: a new opening, just detected
    $orange = [System.Drawing.Color]::FromArgb(255, 0xFF, 0x7A, 0x45)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(64, $orange))), (& $S 37), (& $S 13), (& $S 14), (& $S 14))
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $orange), (& $S 40), (& $S 16), (& $S 8), (& $S 8))
    $g.Dispose()
    return $bmp
}

# 32-bit DIB frame (BITMAPINFOHEADER + bottom-up BGRA + 1-bit AND mask): what .NET's Icon class
# and the notification area read reliably. Only the 256px frame is PNG-compressed.
function To-Dib([System.Drawing.Bitmap]$b) {
    $n = $b.Width; $ms = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $ms
    $maskRow = [int]([Math]::Ceiling($n / 32.0) * 4)
    $w.Write([uint32]40); $w.Write([int32]$n); $w.Write([int32]($n * 2)); $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]0); $w.Write([uint32]($n * $n * 4 + $maskRow * $n)); $w.Write([int32]0); $w.Write([int32]0); $w.Write([uint32]0); $w.Write([uint32]0)
    for ($y = $n - 1; $y -ge 0; $y--) { for ($x = 0; $x -lt $n; $x++) { $c = $b.GetPixel($x, $y); $w.Write([byte]$c.B); $w.Write([byte]$c.G); $w.Write([byte]$c.R); $w.Write([byte]$c.A) } }
    $w.Write((New-Object byte[] ($maskRow * $n))) # alpha channel carries transparency; mask all-opaque
    $w.Flush(); return ,$ms.ToArray()
}
$sizes = 16, 24, 32, 48, 64, 128, 256
$preview = Join-Path $env:TEMP 'lookout-icon-preview.png'
$pngs = foreach ($s in $sizes) {
    $b = Draw-Logo $s
    if ($s -ge 256) { $b.Save($preview, [System.Drawing.Imaging.ImageFormat]::Png); $ms = New-Object System.IO.MemoryStream; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bytes = $ms.ToArray() }
    else { $bytes = To-Dib $b }
    $b.Dispose(); ,$bytes
}
$fs = [System.IO.File]::Create($out); $bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $d = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $bw.Write([byte]$d); $bw.Write([byte]$d); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$pngs[$i].Length); $bw.Write([uint32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Close()
Write-Host "Wrote $out"
