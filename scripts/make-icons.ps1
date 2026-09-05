# ============================================================
#  make-icons.ps1 -- 生成中国象棋 App 图标（全套尺寸）
#
#  设计：木质圆形棋子 + 楷体红色「帥」+ 经典双圈边框
#
#  ⚠️ 重要：输出必须是 24bpp 不含 Alpha 通道的 PNG！
#     App Store 上传校验会拒绝带 Alpha 的图标：
#       "Invalid large app icon ... can't be transparent
#        or contain an alpha channel" (409)
#     因此棋子圆形之外不能留透明，而要铺满深色背景。
#
#  用法：powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
# ============================================================

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$outDir   = Join-Path $repoRoot 'app\static\icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

Write-Host ''
Write-Host 'Xiangqi App Icon Generator' -ForegroundColor Cyan
Write-Host "  output: $outDir"
Write-Host ''

# ---------------- 配色 ----------------
$cBgOuter   = [System.Drawing.Color]::FromArgb(255, 60, 42, 32)   # 背景四角（深木色）
$cBgInner   = [System.Drawing.Color]::FromArgb(255, 92, 64, 46)   # 背景中心（稍亮）
$cWoodHi    = [System.Drawing.Color]::FromArgb(255, 240, 209, 155) # 棋子高光
$cWoodMid   = [System.Drawing.Color]::FromArgb(255, 214, 164, 96)  # 棋子木色
$cWoodLo    = [System.Drawing.Color]::FromArgb(255, 158, 110, 58)  # 棋子暗部
$cRed       = [System.Drawing.Color]::FromArgb(255, 190, 30, 45)   # 中国红

# 生成单个尺寸；返回文件路径
function New-Icon {
    param([int]$Size, [string]$Path)

    # 关键：用 24bpp RGB，从根上不存在 Alpha 通道
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size,
              [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # ---- 1. 背景：径向渐变铺满整个方形（无透明区）----
    $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $bgPath.AddRectangle((New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)))
    $bgBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($bgPath)
    $bgBrush.CenterColor    = $cBgInner
    $bgBrush.SurroundColors = @($cBgOuter)
    $g.FillRectangle($bgBrush, 0, 0, $Size, $Size)
    $bgBrush.Dispose(); $bgPath.Dispose()

    # ---- 2. 棋子圆形：留一点边距，让深色背景成为画框 ----
    $margin = [int]($Size * 0.055)
    $d      = $Size - $margin * 2
    $circle = New-Object System.Drawing.Rectangle($margin, $margin, $d, $d)

    # 棋子木质径向渐变（高光偏左上，模拟立体光泽）
    $cPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $cPath.AddEllipse($circle)
    $woodBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($cPath)
    $woodBrush.CenterPoint  = New-Object System.Drawing.PointF(
                                 ($margin + $d * 0.38), ($margin + $d * 0.34))
    $woodBrush.CenterColor  = $cWoodHi
    $woodBrush.SurroundColors = @($cWoodLo)
    # 中间过渡到木色，避免高光到暗部太突兀
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend(3)
    $blend.Colors    = @($cWoodLo, $cWoodMid, $cWoodHi)
    $blend.Positions = @(0.0, 0.55, 1.0)
    $woodBrush.InterpolationColors = $blend
    $g.FillEllipse($woodBrush, $circle)
    $woodBrush.Dispose(); $cPath.Dispose()

    # ---- 3. 双圈边框（经典棋子样式）----
    $penOuterW = [Math]::Max(1.0, $Size * 0.030)
    $penInnerW = [Math]::Max(1.0, $Size * 0.018)
    $penOuter = New-Object System.Drawing.Pen($cRed, $penOuterW)
    $g.DrawEllipse($penOuter, $circle)
    $penOuter.Dispose()

    $inset = [int]($Size * 0.085)
    $inner = New-Object System.Drawing.Rectangle(
                 ($margin + $inset), ($margin + $inset),
                 ($d - $inset * 2), ($d - $inset * 2))
    $penInner = New-Object System.Drawing.Pen($cRed, $penInnerW)
    $g.DrawEllipse($penInner, $inner)
    $penInner.Dispose()

    # ---- 4. 「帥」字（楷体优先，中文字体名是本地化的「楷体」）----
    $fontName = '楷体'
    foreach ($n in @('楷体', 'KaiTi', 'STKaiti', '楷体_GB2312', '宋体', 'SimSun')) {
        try {
            $tf = New-Object System.Drawing.FontFamily($n)
            $fontName = $tf.Name; $tf.Dispose(); break
        } catch { continue }
    }

    # ⚠️ 不要用 DrawString + LineAlignment::Center 来居中汉字！
    #    那样居中的是「字体行高盒」（含 ascent/descent 的空白），
    #    而汉字墨迹在行高盒内本身就偏上，结果视觉上必然偏移，
    #    再手工加 offsetY 补偿只是碰运气，换字体/换尺寸就又歪了。
    #
    #    正确做法：先把字形转成 GraphicsPath，量出墨迹的真实包围盒
    #    (GetBounds)，再按包围盒中心与圆心的差值做平移。
    #    这样无论什么字体、什么尺寸都精确居中。
    $fontSize = $d * 0.52
    $font = New-Object System.Drawing.Font($fontName, $fontSize,
                [System.Drawing.FontStyle]::Bold,
                [System.Drawing.GraphicsUnit]::Pixel)

    # 棋子圆心（注意是圆心，不是画布中心；两者因 margin 而一致，但显式写出更清晰）
    $cx = [float]($margin + $d / 2.0)
    $cy = [float]($margin + $d / 2.0)

    $glyph = New-Object System.Drawing.Drawing2D.GraphicsPath
    $emSize = $font.SizeInPoints * $g.DpiY / 72.0   # 转成与 Pixel 单位一致的 em 尺寸
    $glyph.AddString('帥', $font.FontFamily, [int][System.Drawing.FontStyle]::Bold,
                     [float]$emSize,
                     (New-Object System.Drawing.PointF(0, 0)),
                     [System.Drawing.StringFormat]::GenericTypographic)

    $gb = $glyph.GetBounds()   # 墨迹真实边界
    $mv = New-Object System.Drawing.Drawing2D.Matrix
    $mv.Translate([float]($cx - ($gb.X + $gb.Width  / 2.0)),
                  [float]($cy - ($gb.Y + $gb.Height / 2.0)))
    $glyph.Transform($mv)
    $mv.Dispose()

    $redBrush = New-Object System.Drawing.SolidBrush($cRed)
    $g.FillPath($redBrush, $glyph)

    $redBrush.Dispose(); $glyph.Dispose(); $font.Dispose()

    $g.Dispose()
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return $fontName
}

# ---------------- 需要的全部尺寸 ----------------
#  Android: 48/72/96/144/192(mdpi~xxxhdpi) + 512(Play)
#  iOS:     20/29/40/58/57/60/76/80/87/114/120/152/167/180 + 1024(App Store)
$sizes = @(20,29,40,48,57,58,60,72,76,80,87,96,114,120,144,152,167,180,192,512,1024)

$used = ''
$total = 0
foreach ($s in $sizes) {
    $p = Join-Path $outDir "icon-$s.png"
    $used = New-Icon -Size $s -Path $p
    $len = (Get-Item $p).Length
    $total += $len
    $kb   = [math]::Round($len / 1KB, 1)
    $name = "icon-$s.png"
    Write-Host ("  [OK] " + $name.PadRight(20) + ([string]$kb).PadLeft(7) + " KB")
}

Write-Host ''
Write-Host ("  font used : $used")
Write-Host ("  files     : $($sizes.Count)")
Write-Host ("  total size: $([math]::Round($total/1KB,1)) KB")
Write-Host ''
Write-Host '  NOTE: all icons are 24bpp RGB, no alpha channel (App Store safe).' -ForegroundColor Yellow
Write-Host ''
