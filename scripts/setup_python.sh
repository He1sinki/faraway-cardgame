#!/usr/bin/env bash
set -euo pipefail
PY_BIN="${PY_BIN:-python3}"
if [[ ! -x $(command -v $PY_BIN || echo /dev/null) ]]; then
  echo "[setup_python] Python introuvable" >&2
  exit 1
fi
if [[ ! -d .venv ]]; then
  echo "[setup_python] Création venv";
  $PY_BIN -m venv .venv
fi
. .venv/bin/activate
pip install --upgrade pip
pip install -r rl/requirements.txt
echo "[setup_python] OK"
