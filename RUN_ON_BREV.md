# Run Person B on Brev

Use **Brev for real Nemotron + DSSAT runs**. Windows runs the local synthetic
checks and transfers source/results. The existing Brev application is a copied
snapshot: pushing Git does not update it. These instructions do not restart the
model or environment servers. No remote job was started while writing this guide.

Run the blocks in order. Blocks 1 and 2 run on your Windows machine; everything
after connecting by SSH runs on Brev. Every experiment needs a new output path.

## 1. Windows PowerShell: package the committed branch

```powershell
cd C:\Users\anand\Development\NightShift
git switch person-B
git status --short --branch
git log -1 --oneline
New-Item -ItemType Directory -Force tmp | Out-Null
git bundle create tmp/fieldtwin-person-b.bundle person-B
wsl.exe -d Ubuntu
```

The untracked `fieldtwin.pdf` and `friction-log.txt` are expected. Git bundles
contain committed Git objects; these untracked files are not included. If there
are other tracked changes, commit/review those before expecting them on Brev.
The bundle preserves Git history/commit provenance without requiring GitHub
credentials on the remote machine.

## 2. Local WSL Ubuntu: upload and connect

```bash
scp /mnt/c/Users/anand/Development/NightShift/tmp/fieldtwin-person-b.bundle \
  fieldtwin-b0:/ephemeral/fieldtwin/fieldtwin-person-b.bundle
ssh fieldtwin-b0
```

The SSH alias is from the existing handoff. If SSH fails, resolve the connection
first; do not substitute a different machine or public model endpoint.

## 3. Brev: create an isolated checkout and check services

```bash
export APP="/ephemeral/fieldtwin/person-b-$(date -u +%Y%m%dT%H%M%SZ)"
git clone --branch person-B /ephemeral/fieldtwin/fieldtwin-person-b.bundle "$APP"
cd "$APP"
git log -1 --oneline
git status --short --branch

# Reuse the existing application Python: this milestone added no dependencies.
export PY=/ephemeral/fieldtwin/app-a-env/.venv/bin/python
test -x "$PY"
"$PY" --version
"$PY" -c 'import fieldtwin_agents; print(fieldtwin_agents.__file__)'

export FIELDTWIN_ENV_URL=http://127.0.0.1:9001
export VLLM_BASE_URL=http://127.0.0.1:8000/v1
export VLLM_MODEL=nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16
unset FIELDTWIN_CONFIG FIELDTWIN_SIMULATOR FIELDTWIN_MODEL_BACKEND

curl -fsS "$FIELDTWIN_ENV_URL/health"
curl -fsS http://127.0.0.1:8000/health
curl -fsS "$VLLM_BASE_URL/models"
nvidia-smi
```

The import path must point into the new `$APP`. The environment must report
`{"ok":true,"simulator":"dssat"}`. `/models` must advertise the exact model ID
above. If it differs, stop and reconcile the model identity and audit expectations
before running. If a check fails, inspect the service logs. Do not silently
use port 9000, `--stub`, or `--synthetic-env` for a real crop experiment. Check
that another season experiment is not already running before adding workload.
The historical model context limit is 16384; confirm the actual serving config
before attributing context/output failures to the policy.

## 4. Brev: local regression and real model parser smoke

```bash
"$PY" -m pytest tests/test_agents.py tests/test_local_pipeline.py -q

export CHECK="results/live-check-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$CHECK"
"$PY" -m fieldtwin_agents smoke \
  --vllm-url "$VLLM_BASE_URL" --model "$VLLM_MODEL" \
  --output "$CHECK/model-smoke.json"
```

The smoke uses the real GPU model but no DSSAT season. It checks advertised model
identity and a parsed tool call. It does **not** establish critic accuracy. Keep
thinking off and v1 prompts for this first runtime comparison.

## 5. Brev: pilot on one dev year

This runs two real seasons: single and multi on 1990. It exercises the new facts,
role flow, final-action verification and receipts with the live model/DSSAT pair.

```bash
head -n 1 tasks/dev.jsonl > "$CHECK/pilot-dev.jsonl"
export PILOT="$CHECK/pilot"
"$PY" -m fieldtwin_agents run \
  --tasks "$CHECK/pilot-dev.jsonl" \
  --env-url "$FIELDTWIN_ENV_URL" \
  --vllm-url "$VLLM_BASE_URL" --model "$VLLM_MODEL" \
  --configs single multi --concurrency 1 \
  --prompt-version v1 --freeze-manifest config/prompts-v1.freeze.json \
  --experiment-kind runtime --output "$PILOT"
```

Audit and inspect the pilot before starting the full workload:

```bash
"$PY" - "$PILOT" <<'PY'
import json, pathlib, sys
from fieldtwin_agents.validation import audit_run
from fieldtwin_agents.experiments import atomic_json
p = pathlib.Path(sys.argv[1])
report = audit_run(p, require_live=True)
report['scope'] = 'Live model with DSSAT; one dev year pilot, no held-out evaluation'
atomic_json(p/'audit.json', report)
for log in sorted((p/'runs').glob('*/*.jsonl')):
    events = [json.loads(line) for line in log.read_text().splitlines()]
    issues = [e for e in events if e['kind'] == 'fallback' or 'validation_error' in e['data']]
    truncated = [e for e in events if e['data'].get('inference', {}).get('finish_reason') == 'length']
    print(log, 'fallbacks/validation errors:', len(issues), 'length finishes:', len(truncated))
    for event in issues + truncated:
        print(json.dumps(event))
print('Audit passed. Inspect full role traces and model usage before the full run.')
PY
"$PY" -m fieldtwin_agents analyze "$PILOT"
```

The manual audit call avoids the older validation CLI's hardcoded synthetic-scope
label. Inspect `diagnostics.json`, both JSONL traces and receipts. Check that the
new evidence fits the actual context, outputs are complete, fallbacks/errors are
understood, and critic objections agree with the facts. An audit pass verifies
record consistency and constraints, not semantic accuracy or agronomic quality.
Fresh valid/invalid role diagnostics remain necessary before declaring the critic
improved. Do not treat a good 1990 reward as evidence across years.

## 6. Brev: full dev run, after reviewing the pilot

This is a **separate manual step**, not automatically started by the pilot.
It runs 40 real seasons: two policies x 20 dev years. No held-out years or
training. It reuses the frozen farmer references rather than regenerating them.

```bash
export FULL="results/runtime-p3-v1-dev-$(date -u +%Y%m%dT%H%M%SZ)"
export LOG="${FULL}.log"
mkdir -p results
nohup "$PY" -u -m fieldtwin_agents run \
  --tasks tasks/dev.jsonl --env-url "$FIELDTWIN_ENV_URL" \
  --vllm-url "$VLLM_BASE_URL" --model "$VLLM_MODEL" \
  --configs single multi --concurrency 8 \
  --prompt-version v1 --freeze-manifest config/prompts-v1.freeze.json \
  --experiment-kind runtime --output "$FULL" \
  > "$LOG" 2>&1 < /dev/null &
export JOB=$!
printf 'APP=%s\nFULL=%s\nLOG=%s\nPID=%s\n' "$APP" "$FULL" "$LOG" "$JOB" \
  | tee "${FULL}.location.txt"
```

Save the printed paths. `nohup` allows disconnection. A new SSH session must `cd`
back to the recorded `$APP` and restore `$PY`/`$FULL`; shell variables do not
persist across sessions. No duration or GPU-cost estimate has been validated for
protocol 3.

Monitor from the same shell (or restore the paths first):

```bash
tail -n 40 "$LOG"
find "$FULL/receipts" -name '*.json' ! -name '*.started.json' | wc -l
"$PY" scripts/run_local_milestone.py --catalogue-only --output "$FULL"
```

The catalogue command only rebuilds records; it does not launch synthetic or real
seasons. Logs may be quiet between progress messages. Completion means 40
**completed** receipts, a complete eval.csv, and a passing audit, not merely 40
terminal receipts. Failures remain failures. Never retry an uncertain step or
reuse an existing experiment directory.

## 7. Brev: audit, report against the frozen dev reference, and back up

After the job finishes, run this in the same environment:

```bash
"$PY" - "$FULL" <<'PY'
import csv, json, pathlib, statistics, sys
from fieldtwin_agents.validation import audit_run
from fieldtwin_agents.experiments import atomic_json
p = pathlib.Path(sys.argv[1])
audit = audit_run(p, require_live=True)
audit['scope'] = 'Live model with DSSAT; dev 1990-2009 only; no held-out evaluation'
atomic_json(p/'audit.json', audit)
rows = list(csv.DictReader((p/'eval.csv').open()))
with open('results_baseline/eval.csv') as f:
    reference = {r['task_id']: r for r in csv.DictReader(f)
                 if r['split'] == 'dev' and r['config'] == 'farmer_ufga'}
comparison = {}
for config in ('single', 'multi'):
    selected = [r for r in rows if r['config'] == config]
    assert len(selected) == 20 and {r['task_id'] for r in selected} == set(reference)
    delta = [float(r['reward']) - float(reference[r['task_id']]['reward']) for r in selected]
    means = {k: statistics.mean(float(r[k]) for r in selected)
             for k in ('reward', 'profit_usd_ha', 'grain_kg_ha', 'n_applied', 'irr_mm', 'n_leached')}
    comparison[config] = {'means': means, 'mean_reward_delta_vs_farmer_ufga': statistics.mean(delta),
                          'years_beating_farmer_ufga': sum(d > 0 for d in delta),
                          'fallbacks': sum(int(r['fallbacks']) for r in selected)}
atomic_json(p/'farmer-comparison.json', comparison)
print(json.dumps(comparison, indent=2))
PY
"$PY" -m fieldtwin_agents analyze "$FULL"
tar -czf "${FULL}.tar.gz" "$FULL" "$LOG" "${FULL}.location.txt"
printf 'Back up this file: %s/%s.tar.gz\n' "$APP" "$FULL"
```

Only dev reference rows enter the calculation. Judge reward and resource use,
reliability and measured inference cost together. These are runtime comparisons;
do not use the prompt-only `compare` command against protocol-2 archives.

From a **second local WSL terminal**, copy the printed absolute archive path:

```bash
scp fieldtwin-b0:/ephemeral/fieldtwin/REPLACE_WITH_PRINTED_ARCHIVE_PATH \
  /mnt/c/Users/anand/Development/NightShift/tmp/
```

Replace the entire remote path with the path printed by the previous command.
Keep every failed/negative result. Person A owns held-out evaluation. No code or
prompt promotion follows automatically from one stochastic dev rollout per year.
