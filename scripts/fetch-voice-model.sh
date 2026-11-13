#!/usr/bin/env bash
# 下载离线中文女声音模（Piper TTS）
# 用法：bash scripts/fetch-voice-model.sh
#
# 模型来源：https://huggingface.co/rhasspy/piper-voices （MIT）
# 国内直连用 hf-mirror 镜像，失败会自动回落到官方地址。

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/tts/voices"
mkdir -p "$DIR"

BASES=(
  "https://hf-mirror.com/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium"
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium"
)
FILES=("zh_CN-huayan-medium.onnx" "zh_CN-huayan-medium.onnx.json")

for f in "${FILES[@]}"; do
  if [ -f "$DIR/$f" ]; then
    echo "已存在，跳过：$f"
    continue
  fi
  echo "下载 $f ..."
  ok=0
  for b in "${BASES[@]}"; do
    if curl -fL --connect-timeout 20 -o "$DIR/$f" "$b/$f"; then
      ok=1
      break
    fi
    echo "  $b 失败，尝试下一个"
  done
  [ "$ok" = "1" ] || { echo "下载失败：$f" >&2; exit 1; }
done

echo ""
echo "离线音色模型就绪。接着可以打包：npm run dist"
