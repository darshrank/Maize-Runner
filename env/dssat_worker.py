"""gym-DSSAT worker process. Runs under gym-DSSAT's own Python (3.10, gym 0.21,
numpy 1.x), NOT the project's Python: env/dssat_sim.py launches it with
/opt/gym_dssat_pdi/bin/python and talks to it over stdin/stdout, one JSON
object per line.

Commands (request -> response):
  {"cmd": "start", "seed": int, "record_weather": bool}
      -> {"state": {...}, "weather": [...] | null}
     Starts the maize season for `seed`. With record_weather, first plays the
     whole season with zero actions to record its daily weather (gym-DSSAT
     generates weather as it goes, so this is the only way to see future days),
     then restarts the same seed. Weather does not depend on management.
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
WEATHER_KEYS = ("yrdoy", "tmax", "tmin", "rain", "srad")


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

    def _make(self, seed):
        import gym  # imported lazily so a broken install reports a clean error
        self.close_env()
        # The constructor starts a season whose weather is drawn from `seed`,
        # identical to env.reset(seed=seed). We drive the unwrapped env: gym's
        # order-enforcing wrapper would demand a reset(), which first plays out
        # the constructor's whole season (~1.5 s) for nothing.
        self.env = gym.make("gym_dssat_pdi:GymDssatPdi-v0", run_dssat_location=RUN_DSSAT,
                            mode="all", seed=seed, random_weather=True, log_saving_path=None).unwrapped
        return self.env

    def start(self, seed, record_weather):
        u = self._make(seed)
        weather = None
        if record_weather:
            weather = []
            while not u.done:
                weather.append({k: u._state[k] for k in WEATHER_KEYS})
                u.step({"anfer": 0.0, "amir": 0.0})
            u.reset(seed=seed)
        return {"state": u._state, "weather": weather}

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
                send(worker.start(int(req["seed"]), bool(req.get("record_weather"))))
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
