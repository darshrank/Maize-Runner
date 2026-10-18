"""Deterministic plumbing fixtures. Not DSSAT, a learned model, or agronomic evidence."""
from __future__ import annotations

import asyncio
import json
import random
import uuid

from .contracts import Action, TOOLS, Task


class StubEnvironment:
    synthetic = True

    def __init__(self, weeks=16):
        self.weeks, self.episodes = weeks, {}

    def obs(self, s):
        return {"stage": "vegetative" if s["week"] < 9 else "reproductive",
                "soil_water_mm": s["water"], "soil_n_kg_ha": s["soil_n"]}

    async def reset(self, task):
        episode_id = str(uuid.uuid4())
        s = {"week": 0, "seed": task.year if task.year is not None else task.weather_seed, "water": 50., "soil_n": 20.,
             "n_applied": 0., "irr_mm": 0., "n_leached": 0., "n_uptake": 0., "history": []}
        self.episodes[episode_id] = s
        await asyncio.sleep(0)
        return {"episode_id": episode_id, "obs": self.obs(s), "week": 0}

    def weather(self, s, week):
        # Deterministic per-task weather with noisy tool outlook; hidden truth stays internal.
        rng = random.Random(f"{s['seed']}:{week}:truth")
        return [{"rain_mm": round(rng.uniform(0, 14), 2), "temp_c": round(rng.uniform(20, 35), 2)} for _ in range(7)]

    async def tool(self, name, episode_id):
        s = self.episodes[episode_id]
        await asyncio.sleep(0)
        if name == "get_weather":
            rng = random.Random(f"{s['seed']}:{s['week']}:outlook")
            past = [day for w in range(max(0, s["week"] - 2), s["week"]) for day in self.weather(s, w)]
            outlook = [{"rain_mm": round(d["rain_mm"] * rng.uniform(.6, 1.4), 2),
                        "temp_c": round(d["temp_c"] + rng.uniform(-2, 2), 2)} for d in self.weather(s, s["week"])]
            return {"observed_14d": past, "outlook_7d": outlook, "synthetic": True}
        if name == "get_crop_state":
            return {"stage": self.obs(s)["stage"], "n_stress": s["soil_n"] < 20, "water_stress": s["water"] < 30}
        if name == "get_soil":
            return {"soil_water_mm": s["water"], "soil_n_kg_ha": s["soil_n"]}
        if name == "get_history":
            return s["history"][:]
        if name == "get_budget":
            return {"n_applied": s["n_applied"], "remaining_n_kg_ha": max(0, 240 - s["n_applied"])}
        raise ValueError("Unknown tool")

    async def step(self, episode_id, action):
        s = self.episodes[episode_id]
        if s["week"] >= self.weeks:
            raise ValueError("Episode already complete")
        if action != action.guarded(1e9):
            raise ValueError("Action outside weekly bounds")
        rain = sum(d["rain_mm"] for d in self.weather(s, s["week"]))
        s["n_applied"] += action.n_kg_ha
        s["irr_mm"] += action.irr_mm
        s["water"] = min(120., max(0., s["water"] + rain + action.irr_mm - 35))
        leached = min(s["soil_n"] + action.n_kg_ha, max(0, rain - 35) * .15)
        uptake = min(12., s["soil_n"] + action.n_kg_ha - leached)
        s["soil_n"] += action.n_kg_ha - leached - uptake
        s["n_leached"] += leached
        s["n_uptake"] += uptake
        s["history"].append({"week": s["week"], **action.as_dict()})
        s["week"] += 1
        result = {"obs": self.obs(s), "week": s["week"], "done": s["week"] == self.weeks,
                  "weekly": {"rain_mm": rain, "n_leached": leached, "n_uptake": uptake}}
        if result["done"]:
            grain = 2000 + 25 * s["n_uptake"]
            profit = grain * .2 - s["n_applied"] - s["irr_mm"] * .2
            result["final"] = {"grain_kg_ha": grain, **{k: s[k] for k in ("n_applied", "n_uptake", "n_leached", "irr_mm")},
                               "n_gas": 0., "profit_usd_ha": profit, "reward": profit - 2 * s["n_leached"]}
        await asyncio.sleep(0)
        return result

    async def close(self):
        pass


class StubModel:
    synthetic = True

    async def complete(self, messages, tools):
        await asyncio.sleep(0)
        context = json.loads(messages[1]["content"])
        read_tools = [t for t in tools if t != "submit_decision"]
        if read_tools and not any(m["role"] == "tool" for m in messages):
            return {"role": "assistant", "content": None, "tool_calls": [
                {"id": f"stub-{i}", "type": "function", "function": {"name": t, "arguments": "{}"}}
                for i, t in enumerate(read_tools)]}
        output = context["output"]
        if output == "critique":
            content = json.dumps({"accept": True, "objection": ""})
        elif output == "action":
            proposal = context.get("proposal")
            content = json.dumps(proposal or {"n_kg_ha": 40 if context["week"] in (0, 5, 9) else 0,
                                             "irr_mm": 0, "reason": "Synthetic split-schedule fixture."})
        else:
            content = "Synthetic specialist report; use only for plumbing verification."
        return {"role": "assistant", "content": content}

    async def close(self):
        pass


def serve_stub(host="127.0.0.1", port=9000):
    # One synchronous server avoids sharing asyncio state across request event loops.
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from urllib.parse import parse_qs, urlparse
    env = StubEnvironment()

    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status, data):
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            try:
                data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
                if self.path == "/reset":
                    result = asyncio.run(env.reset(Task(**data)))
                elif self.path == "/step":
                    result = asyncio.run(env.step(data["episode_id"], Action.parse(data)))
                else:
                    return self.send_json(404, {"error": "not found"})
                self.send_json(200, result)
            except (ValueError, TypeError, KeyError) as exc:
                self.send_json(400, {"error": str(exc)})

        def do_GET(self):
            parsed = urlparse(self.path)
            name = parsed.path.removeprefix("/tool/")
            if not parsed.path.startswith("/tool/") or name not in TOOLS:
                return self.send_json(404, {"error": "not found"})
            try:
                result = asyncio.run(env.tool(name, parse_qs(parsed.query)["episode_id"][0]))
                self.send_json(200, result)
            except (ValueError, KeyError) as exc:
                self.send_json(400, {"error": str(exc)})

    print(f"SYNTHETIC environment listening on http://{host}:{port}", flush=True)
    HTTPServer((host, port), Handler).serve_forever()
