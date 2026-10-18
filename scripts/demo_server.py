"""Demo server: serves the UI (like `python -m http.server 8080`) and lets the Season page start a live season.

  uv run python scripts/demo_server.py            # http://localhost:8080/ui/

POST /api/live/start?task=UFGA-2026  starts scripts/live_season.py for that season (one run at a time)
GET  /api/live/status                running / finished, exit code and the last console lines
Everything else is a static file from the repo root, exactly as http.server serves it. Live runs need the env server
(port 9000) and the vLLM tunnel; nothing for the live season is stored ahead of time.
"""

import subprocess
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
LIVE_TASKS = {"UFGA-2026", "UFGA-2025"}   # seasons outside every tune/check/test split
LOG = ROOT / "runs" / "live" / "console.txt"

app = FastAPI(title="FieldTwin demo server")
state = {"proc": None, "task": None}


@app.post("/api/live/start")
def start(task: str = "UFGA-2026", restart: bool = False):
    if task not in LIVE_TASKS:
        raise HTTPException(400, f"live seasons: {sorted(LIVE_TASKS)}")
    proc = state["proc"]
    if proc is not None and proc.poll() is None:
        if not restart:
            return {"status": "running", "task": state["task"]}
        proc.terminate()                  # a fresh page's Play: stop the old run, start over
        proc.wait(timeout=10)
    for old in (ROOT / "runs" / "live").glob(f"*/{task}.jsonl"):
        old.unlink()                      # an earlier run is never shown, even if this one fails to start
    LOG.parent.mkdir(parents=True, exist_ok=True)
    out = open(LOG, "w")
    state["proc"] = subprocess.Popen([sys.executable, str(ROOT / "scripts" / "live_season.py"), "--task-id", task],
                                     cwd=ROOT, stdout=out, stderr=subprocess.STDOUT)
    state["task"] = task
    return {"status": "started", "task": task}


@app.get("/api/live/status")
def status():
    proc = state["proc"]
    tail = LOG.read_text().splitlines()[-5:] if LOG.exists() else []
    return {"task": state["task"], "running": bool(proc and proc.poll() is None),
            "returncode": None if proc is None else proc.poll(), "tail": tail}


@app.get("/runs/live/{config}/{name}")
def live_log(config: str, name: str):
    """The live log as it is right now (StaticFiles can fail on a file that grows while it is sent)."""
    path = ROOT / "runs" / "live" / config / name
    if path.parent.parent != ROOT / "runs" / "live" or not path.is_file():
        raise HTTPException(404)
    return PlainTextResponse(path.read_text(), headers={"Cache-Control": "no-store"})


app.mount("/", StaticFiles(directory=ROOT, html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8080, log_level="warning")
