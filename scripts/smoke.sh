#!/usr/bin/env bash
# End-to-end smoke test: env server -> one farmer season -> small eval -> checks.
# Prints PASS or FAIL. Run from anywhere: bash scripts/smoke.sh
set -u
cd "$(dirname "$0")/.."

PORT=9000
uv run uvicorn env.server:app --port "$PORT" --log-level warning &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null' EXIT

fail() { echo "FAIL: $1"; exit 1; }

# Wait up to ~30 s for /health.
for _ in $(seq 60); do
  curl -sf "http://localhost:$PORT/health" >/dev/null && break
  sleep 0.5
done
curl -sf "http://localhost:$PORT/health" >/dev/null || fail "env server did not come up"

uv run python -m agents.run --policy farmer --task-id UFGA-s3 || fail "agents.run farmer"
[ -s runs/farmer/UFGA-s3.jsonl ] || fail "missing runs/farmer/UFGA-s3.jsonl"

uv run python -m eval.run_eval --split dev --limit 3 --configs no_n,farmer,hindsight || fail "eval.run_eval"
[ -s results/eval.csv ] || fail "missing results/eval.csv"
[ -s results/summary.md ] || fail "missing results/summary.md"

# farmer must beat no_n on average reward (dev split rows in eval.csv).
uv run python - <<'PY' || fail "farmer reward <= no_n reward"
import csv, statistics, sys
rows = [r for r in csv.DictReader(open("results/eval.csv")) if r["split"] == "dev"]
mean = lambda c: statistics.mean(float(r["reward"]) for r in rows if r["config"] == c)
farmer, no_n = mean("farmer"), mean("no_n")
print(f"mean reward: farmer {farmer:.1f}, no_n {no_n:.1f}")
sys.exit(0 if farmer > no_n else 1)
PY

echo "PASS"
