"""Cross-platform walking-skeleton smoke, with all B policies and no GPU.

Writes normal replay logs/index and toy/stub eval outputs for the UI. All tasks are dev.
Run with: uv run python scripts/check_skeleton_agents.py
"""
import csv
import json
import os
import socket
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIGS = ["no_n", "farmer", "hindsight", "single", "multi", "multi_no_critic", "multi_no_weather", "multi_no_tools"]


def main():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    with tempfile.TemporaryDirectory() as tmp:
        cfg = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
        cfg["env"]["url"] = f"http://127.0.0.1:{port}"
        cfg["env"]["simulator"] = "toy"
        cfg["agents"]["backend"] = "stub"
        path = Path(tmp) / "config.yaml"
        path.write_text(yaml.safe_dump(cfg), encoding="utf-8")
        environ = {**os.environ, "FIELDTWIN_CONFIG": str(path), "FIELDTWIN_MODEL_BACKEND": "stub"}
        server = subprocess.Popen([sys.executable, "-m", "uvicorn", "env.server:app", "--port", str(port),
                                   "--log-level", "warning"], cwd=ROOT, env=environ,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            with httpx.Client(timeout=1) as http:
                for _ in range(100):
                    try:
                        response = http.get(cfg["env"]["url"] + "/health")
                        if response.status_code == 200:
                            break
                    except httpx.TransportError:
                        pass
                    if server.poll() is not None:
                        raise RuntimeError("Toy server exited before readiness")
                    time.sleep(.1)
                else:
                    raise RuntimeError("Toy server did not become ready")
            for policy in ("farmer", "single", "multi"):
                subprocess.run([sys.executable, "-m", "agents.run", "--policy", policy,
                                "--task-id", "UFGA-1992", "--split", "dev"], cwd=ROOT, env=environ,
                               check=True, capture_output=True, text=True, timeout=90)
            completed = subprocess.run([sys.executable, "-m", "eval.run_eval", "--split", "dev",
                "--configs", ",".join(CONFIGS), "--limit", "3"], cwd=ROOT, env=environ,
                check=True, capture_output=True, text=True, timeout=180)
            rows = list(csv.DictReader((ROOT / "results/eval.csv").open(newline="", encoding="utf-8")))
            rows = [r for r in rows if r["split"] == "dev" and r["task_id"] in {"UFGA-1990", "UFGA-1991", "UFGA-1992"}
                    and r["config"] in CONFIGS]
            if len(rows) != 24:
                raise RuntimeError("Expected 24 config/task rows")
            mean = lambda config: statistics.mean(float(r["reward"]) for r in rows if r["config"] == config)
            if mean("farmer") <= mean("no_n"):
                raise RuntimeError("Farmer must beat no_n on the toy baseline smoke")
            if "Synthetic plumbing results" not in (ROOT / "results/summary.md").read_text(encoding="utf-8"):
                raise RuntimeError("Missing synthetic provenance in summary")
            index = json.loads((ROOT / "runs/index.json").read_text())
            for config in CONFIGS:
                if not {"UFGA-1990", "UFGA-1991", "UFGA-1992"} <= set(index[config]):
                    raise RuntimeError(f"Missing replay index entries for {config}")
            print(json.dumps({"skeleton_http_integration": "passed", "synthetic": True,
                              "eval_rows": 24, "configs": CONFIGS, "task_split": "dev",
                              "baseline_farmer_beats_no_n": True, "replay_index_verified": True}))
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__ == "__main__":
    main()
