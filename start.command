#!/bin/bash
cd "$(dirname "$0")" || exit 1
python3 -m http.server 8765 --bind 0.0.0.0
