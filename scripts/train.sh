#!/usr/bin/env bash
set -euo pipefail
PY=${PYTHON:-python3}
RUN_DIR="runs"
mkdir -p "$RUN_DIR"
exec $PY rl/learner.py "$@"
