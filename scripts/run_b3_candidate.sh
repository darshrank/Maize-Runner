#!/usr/bin/env bash
# Continue the dev-only paired experiment after the baseline audit finishes.
# Run from the repository root. Existing run directories are never overwritten.
set -euo pipefail
BASELINE="${1:-results/dssat-dev-v1}"
CANDIDATE="${2:-results/dssat-dev-v3}"
PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"
ENV_URL="${FIELDTWIN_ENV_URL:-http://127.0.0.1:9001}"
MODEL_URL="${VLLM_BASE_URL:-http://127.0.0.1:8000/v1}"
mkdir -p results
state() {
  "$PYTHON_BIN" - "$1" "$BASELINE" "$CANDIDATE" <<'PY'
import json, pathlib, sys
from datetime import datetime, timezone
path = pathlib.Path('results/b3-progress.json')
path.write_text(json.dumps({'phase':sys.argv[1], 'updated_at':datetime.now(timezone.utc).isoformat(),
                           'baseline':sys.argv[2], 'candidate':sys.argv[3]}, indent=2)+'\n')
PY
}
trap 'state failed' ERR
state waiting_for_baseline_audit
deadline=$((SECONDS + 3600))
until test -f "$BASELINE/audit.json" && test -f "$BASELINE/diagnostics.json"; do
  if test -f "$BASELINE/errors.json" || (( SECONDS >= deadline )); then state failed; exit 1; fi
  sleep 5
done
"$PYTHON_BIN" - "$BASELINE" <<'PY'
import sys
from fieldtwin_agents.evaluation import read_run
from fieldtwin_agents.runner import prompt_hashes
manifest, rows = read_run(sys.argv[1])
assert len(rows) == 40 and set(manifest['configs']) == {'single','multi'}
assert not manifest['synthetic']
before, after = prompt_hashes('v1'), prompt_hashes('v3')
assert [name for name in before if before[name] != after[name]] == ['coordinator.txt']
PY
state running_candidate
"$PYTHON_BIN" -m fieldtwin_agents run --tasks tasks/dev.jsonl --env-url "$ENV_URL" \
  --vllm-url "$MODEL_URL" --configs single multi --output "$CANDIDATE" \
  --concurrency 8 --prompt-version v3 --freeze-manifest config/prompts-v3.candidate.json
state auditing_candidate
"$PYTHON_BIN" -m fieldtwin_agents.validation "$CANDIDATE" --output "$CANDIDATE/audit.json"
"$PYTHON_BIN" -m fieldtwin_agents analyze "$CANDIDATE"
"$PYTHON_BIN" -m fieldtwin_agents compare "$BASELINE" "$CANDIDATE" \
  --change "Coordinator separates the nitrogen cap from irrigation; uses the shared farmer watering rule in dry weeks" \
  --output results/b3-iterations.md
state candidate_complete_selection_pending
