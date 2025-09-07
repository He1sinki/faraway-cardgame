#!/usr/bin/env bash
# Wrapper pour garantir qu'on utilise un Python fonctionnel.
# Priorité: .venv -> python -> python3
set -euo pipefail

if [[ -x .venv/bin/python ]]; then
  PY=.venv/bin/python
elif command -v python >/dev/null 2>&1; then
  PY=python
elif command -v python3 >/dev/null 2>&1; then
  PY=python3
else
  echo "[python.sh] Erreur: ni .venv/bin/python ni python ni python3 trouvés dans PATH" >&2
  exit 127
fi
exec "$PY" "$@"
