"""Exercise the real HTTP stub and CLI without a GPU; no agronomic claims."""
import json
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx


def main():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = subprocess.Popen([sys.executable, "-m", "fieldtwin_agents", "stub-server", "--port", str(port)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        url = f"http://127.0.0.1:{port}"
        for _ in range(100):
            try:
                httpx.get(url + "/health", timeout=.5)
                break
            except httpx.TransportError:
                if server.poll() is not None:
                    raise RuntimeError("Stub server exited before readiness")
                time.sleep(.05)
        else:
            raise RuntimeError("Stub server did not become ready")
        with tempfile.TemporaryDirectory() as tmp:
            output = str(Path(tmp) / "http-run")
            completed = subprocess.run([sys.executable, "-m", "fieldtwin_agents", "run", "--stub-model",
                "--synthetic-env", "--env-url", url, "--tasks", "fixtures/dev.stub.jsonl",
                "--configs", "single", "multi", "--output", output, "--concurrency", "8",
                "--freeze-manifest", "config/prompts-v1.freeze.json"],
                check=True, capture_output=True, text=True, timeout=120)
            result = json.loads(completed.stdout)
            if result["seasons_completed"] != 40 or not result["synthetic"]:
                raise RuntimeError("Unexpected HTTP integration result")
            print(json.dumps({"http_integration": "passed", **result, "output": "temporary directory (cleaned)"}))
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()


if __name__ == "__main__":
    main()
