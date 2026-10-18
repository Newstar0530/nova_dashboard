#!/bin/bash
# Mac 啟動器：在 Finder 雙擊就能啟動 Nova Dashboard
cd "$(dirname "$0")" || exit 1

# 找 Python 3.10 以上（macOS 內建的 python3 是 3.9，不夠新）
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
    PY="$c"; break
  fi
done
if [ -z "$PY" ]; then
  echo "需要 Python 3.10 以上。請到 https://www.python.org/downloads/ 下載安裝後再雙擊一次。"
  read -r -p "按 Enter 關閉…"
  exit 1
fi

# 第一次：建立虛擬環境；之後 requirements.txt 有變才重新安裝套件
if [ ! -d .venv ]; then
  echo "第一次啟動，正在安裝套件（約 1 分鐘）…"
  "$PY" -m venv .venv || exit 1
fi
HASH=$(shasum requirements.txt | cut -d' ' -f1)
if [ "$(cat .venv/.req-hash 2>/dev/null)" != "$HASH" ]; then
  .venv/bin/pip install -q -r requirements.txt && echo "$HASH" > .venv/.req-hash
fi

[ -f .env ] || cp .env.example .env
exec .venv/bin/python app.py
