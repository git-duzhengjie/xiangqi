$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$outDir = Join-Path $PSScriptRoot "..\app\static\sounds\_voice_raw"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$syn = New-Object System.Speech.Synthesis.SpeechSynthesizer
$syn.SelectVoice("Microsoft Huihui Desktop")
$syn.Rate = 1
$syn.Volume = 100
# ( [string] :6lbU* [char] © Speak ÑÕ}„ê1%
$pairs = @(
  @{ k = "voice_check";   w = [string]([char]0x5C06 + [char]0x519B) },
  @{ k = "voice_capture"; w = [string][char]0x5403 }
)
foreach ($p in $pairs) {
  $path = Join-Path $outDir ($p.k + ".wav")
  $syn.SetOutputToWaveFile($path)
  $syn.Speak([string]$p.w)
  $syn.SetOutputToNull()
  Write-Output ("[OK] " + $p.k)
}
$syn.Dispose()
Get-ChildItem $outDir | ForEach-Object { Write-Output ($_.Name + " " + $_.Length + "B") }