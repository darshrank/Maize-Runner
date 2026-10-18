#!/usr/bin/env bash
# S3 parallel sweep (Lane C Brev instance only). Levels 1, 8, 20, one at a time. Per level:
#   reset the vLLM prefix cache (POST /reset_prefix_cache, else restart the fieldtwin-vllm container),
#   save /metrics before and after, poll num_requests_running / waiting every 15 s,
#   run A's d1c_multi design on dev from its own repo copy ($S3_BASE_p<N>).
# A failed level writes p<N>/error.txt and the sweep moves on.
# Needs: vLLM on :8000 (scripts/serve_vllm.sh), env server on :9000, copies with .env and .venv.
# Run on the instance from the repo root:
#   nohup setsid bash lanec/scripts/s3_sweep.sh > /ephemeral/s3/sweep.log 2>&1 < /dev/null &
set -uo pipefail

export PATH="$HOME/.local/bin:$PATH"
VLLM=http://localhost:8000
ENV_URL=http://localhost:9000
OUT="${S3_OUT:-/ephemeral/s3}"
BASE="${S3_BASE:-/ephemeral/NightShift}"
LEVELS=(1 8 20)
declare -A LIMIT=([1]="--limit 2" [8]="--limit 8" [20]="")
POLL_S=15

log() { echo "$(date -u +%FT%TZ) $*"; }

mkdir -p "$OUT"
exec 9> "$OUT/sweep.lock"
flock -n 9 || { log "another sweep holds $OUT/sweep.lock"; exit 1; }

wait_models() {  # up to 20 min (cold start with cached weights is ~3 min)
  for _ in $(seq 1 240); do
    curl -sf -m 5 "$VLLM/v1/models" > /dev/null && return 0
    sleep 5
  done
  return 1
}

# Prints the method used on stdout; logs go to stderr.
reset_cache() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 30 -X POST "$VLLM/reset_prefix_cache")
  if [[ "$code" == "200" ]]; then
    echo "POST /reset_prefix_cache 200"
    return 0
  fi
  log "POST /reset_prefix_cache returned $code: restarting fieldtwin-vllm" >&2
  docker stop fieldtwin-vllm > /dev/null 2>&1
  docker rm fieldtwin-vllm > /dev/null 2>&1
  (cd "$BASE" && VLLM_ENABLE_CUDA_COMPATIBILITY=1 VLLM_DETACH=1 \
     HF_HOME=/ephemeral/fieldtwin/huggingface VLLM_CACHE_DIR=/ephemeral/fieldtwin/vllm-cache \
     bash scripts/serve_vllm.sh > /dev/null) || return 1
  wait_models || return 1
  log "fieldtwin-vllm back up" >&2
  echo "container restart (POST /reset_prefix_cache returned $code)"
}

poll() {  # $1 = csv path
  echo "t,num_requests_running,num_requests_waiting" > "$1"
  while true; do
    local m r w
    m=$(curl -s -m 10 "$VLLM/metrics")
    r=$(awk '/^vllm:num_requests_running\{/ {print $2}' <<< "$m")
    w=$(awk '/^vllm:num_requests_waiting\{/ {print $2}' <<< "$m")
    echo "$(date -u +%FT%TZ),$r,$w" >> "$1"
    sleep "$POLL_S"
  done
}

POLLER=""
cleanup() { [[ -n "$POLLER" ]] && kill "$POLLER" 2> /dev/null; }
trap cleanup EXIT

run_level() {  # $1 = parallel level
  local n=$1 d="$OUT/p$1" copy="${BASE}_p$1" method rc start end
  mkdir -p "$d"
  rm -f "$d/error.txt"
  # never overlap a level (pattern = the python process only, not shells that mention it)
  while pgrep -f '^[^ ]*python[0-9.]* -m agents_a\.run_design' > /dev/null; do
    log "level $n: another run_design is running, waiting" ; sleep 60
  done
  [[ -f "$copy/.env" ]] || { echo "missing $copy/.env" > "$d/error.txt"; return 1; }
  curl -sf -m 10 "$ENV_URL/health" > /dev/null || { echo "env server not healthy at $ENV_URL" > "$d/error.txt"; return 1; }

  method=$(reset_cache) || { echo "prefix cache reset failed: vLLM did not come back" > "$d/error.txt"; return 1; }
  echo "$method" > "$d/reset.txt"
  log "level $n: reset = $method"
  curl -sf -m 30 "$VLLM/metrics" > "$d/before.prom" || { echo "GET /metrics (before) failed" > "$d/error.txt"; return 1; }

  poll "$d/poll.csv" &
  POLLER=$!
  start=$(date -u +%FT%TZ)
  log "level $n: run_design --parallel $n ${LIMIT[$n]} from $copy"
  # shellcheck disable=SC2086  # LIMIT is intentionally word-split
  (cd "$copy" && uv run python -m agents_a.run_design --design d1c_multi --split dev --parallel "$n" ${LIMIT[$n]}) > "$d/run.log" 2>&1
  rc=$?
  end=$(date -u +%FT%TZ)
  kill "$POLLER" 2> /dev/null; wait "$POLLER" 2> /dev/null; POLLER=""

  curl -sf -m 30 "$VLLM/metrics" > "$d/after.prom" || echo "GET /metrics (after) failed" >> "$d/error.txt"
  printf 'start %s\nend %s\nexit %s\n' "$start" "$end" "$rc" > "$d/times.txt"
  if (( rc != 0 )); then
    { echo "run_design exit $rc"; tail -n 30 "$d/run.log"; } >> "$d/error.txt"
    return 1
  fi
  [[ -f "$d/error.txt" ]] && return 1
  return 0
}

log "sweep start: levels ${LEVELS[*]}, out $OUT"
for n in "${LEVELS[@]}"; do
  if run_level "$n"; then
    log "level $n: done"
  else
    log "level $n: FAILED (see $OUT/p$n/error.txt)"
  fi
done
log "sweep end"
