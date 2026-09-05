#!/bin/bash
cd "$(dirname "$0")"

if ! command -v python3 &> /dev/null; then
    echo "[HATA] Python bulunamadi!"
    echo "Python yuklemek icin: https://www.python.org/downloads/"
    exit 1
fi

python3 player.py
