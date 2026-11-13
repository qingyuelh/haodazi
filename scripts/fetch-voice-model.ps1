# 下载离线中文女声音模（Piper TTS）
# 用法：powershell -ExecutionPolicy Bypass -File scripts/fetch-voice-model.ps1
#
# 模型来源：https://huggingface.co/rhasspy/piper-voices （MIT）
# 国内直连用 hf-mirror 镜像，失败会自动回落到官方地址。

$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot '..' 'tts\voices'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$base = 'https://hf-mirror.com/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium'
$official = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium'

$files = @('zh_CN-huayan-medium.onnx', 'zh_CN-huayan-medium.onnx.json')

foreach ($f in $files) {
    $out = Join-Path $dir $f
    if (Test-Path $out) { Write-Host "已存在，跳过：$f"; continue }
    Write-Host "下载 $f ..."
    $ok = $false
    foreach ($b in @($base, $official)) {
        try {
            Invoke-WebRequest -Uri "$b/$f" -OutFile $out -UseBasicParsing -TimeoutSec 900
            $ok = $true
            break
        } catch {
            Write-Host "  $b 失败：$($_.Exception.Message)"
        }
    }
    if (-not $ok) { throw "下载失败：$f" }
}

Write-Host ''
Write-Host '离线音色模型就绪。接着可以打包：npm run dist'
