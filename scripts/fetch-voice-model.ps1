# 下载离线中文女声音模（Piper TTS）
# 用法：powershell -ExecutionPolicy Bypass -File scripts/fetch-voice-model.ps1
#
# 模型来源：https://huggingface.co/rhasspy/piper-voices （MIT）
# 国内直连用 hf-mirror 镜像，失败会自动回落到官方地址。

$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..'
$dir = Join-Path $root 'tts\voices'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$bases = @(
  'https://hf-mirror.com/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium',
  'https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium'
)
$files = @('zh_CN-huayan-medium.onnx', 'zh_CN-huayan-medium.onnx.json')

function Get-File($url, $out) {
  # 优先用 curl：它会正确跟随 308 跳转（PowerShell 5.1 的 Invoke-WebRequest 不会）
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & curl.exe -sfL --connect-timeout 20 --max-time 1800 -o $out $url 2>$null | Out-Null
    $ErrorActionPreference = $prev
    return ($LASTEXITCODE -eq 0 -and (Test-Path $out) -and (Get-Item $out).Length -gt 0)
  }
  try {
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 1800
    return $true
  } catch {
    return $false
  }
}

foreach ($f in $files) {
  $out = Join-Path $dir $f
  if ((Test-Path $out) -and (Get-Item $out).Length -gt 0) {
    Write-Host "已存在，跳过：$f"
    continue
  }
  Write-Host "下载 $f ..."
  $ok = $false
  foreach ($b in $bases) {
    if (Get-File "$b/$f" $out) { $ok = $true; break }
    Write-Host "  $b 失败，尝试下一个"
    Remove-Item $out -Force -ErrorAction SilentlyContinue
  }
  if (-not $ok) { throw "下载失败：$f" }
}

Write-Host ''
Write-Host '离线音色模型就绪。接着可以打包：npm run dist'
