"""gym-DSSAT worker process. Runs under gym-DSSAT's own Python (3.10, gym 0.21,
numpy 1.x), NOT the project's Python: env/dssat_sim.py launches it with
/opt/gym_dssat_pdi/bin/python and talks to it over stdin/stdout, one JSON
object per line.

Commands (request -> response):
  {"cmd": "start", "xfile_template": path, "wth": path} -> {"state": {...}}
     Starts the maize season from a (date-shifted) X-file template, with the
     weather generator OFF (WTHER=M) so DSSAT reads the given .WTH file, which
     is copied into the run directory (searched before DSSAT's Weather folder).
  {"cmd": "step", "anfer": float, "amir": float}
      -> {"state": {...} | null, "done": bool}       (one day)
  {"cmd": "close"} -> {"ok": true}, then exit.
Errors -> {"error": "..."}.

Keep this file Python 3.10 compatible.
"""

import json
import os
import sys
import traceback
import warnings

# The protocol owns the real stdout; anything else that prints goes to stderr.
PROTOCOL_OUT = sys.stdout
sys.stdout = sys.stderr
warnings.filterwarnings("ignore")

RUN_DSSAT = os.environ.get("FIELDTWIN_RUN_DSSAT", "/opt/dssat_pdi/run_dssat")


def _to_json(o):
    # gym-DSSAT state values can be numpy scalars or arrays.
    if hasattr(o, "tolist"):
        return o.tolist()
    raise TypeError("not JSON serializable: %r" % type(o))


def send(obj):
    PROTOCOL_OUT.write(json.dumps(obj, default=_to_json) + "\n")
    PROTOCOL_OUT.flush()


class Worker:
    def __init__(self):
        self.env = None

    def start(self, xfile_template, wth):
        import gym  # imported lazily so a broken install reports a clean error
        self.close_env()
        # The constructor starts the season. We drive the unwrapped env: gym's
        # order-enforcing wrapper would demand a reset(), which first plays out
        # the constructor's whole season (~1.5 s) for nothing.
        self.env = gym.make("gym_dssat_pdi:GymDssatPdi-v0", run_dssat_location=RUN_DSSAT,
                            mode="all", random_weather=False, fileX_template_path=xfile_template,
                            auxiliary_file_paths=[wth], log_saving_path=None).unwrapped
        return {"state": self.env._state}

    def step(self, anfer, amir):
        u = self.env
        if u.done:
            return {"state": None, "done": True}
        u.step({"anfer": float(anfer), "amir": float(amir)})
        return {"state": None if u.done else u._state, "done": bool(u.done)}

    def close_env(self):
        if self.env is not None:
            try:
                self.env.close()
            except Exception:
                pass
            self.env = None


def main():
    worker = Worker()
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            req = json.loads(line)
            cmd = req.get("cmd")
            if cmd == "start":
                send(worker.start(req["xfile_template"], req["wth"]))
            elif cmd == "step":
                send(worker.step(req.get("anfer", 0.0), req.get("amir", 0.0)))
            elif cmd == "close":
                worker.close_env()
                send({"ok": True})
                return
            else:
                send({"error": "unknown cmd %r" % cmd})
        except Exception as e:
            traceback.print_exc()
            send({"error": "%s: %s" % (type(e).__name__, e)})
    worker.close_env()


if __name__ == "__main__":
    main()
