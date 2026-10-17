"""Build the NeMo Gym task JSONL files from tasks/*.jsonl and agents/tools.json.

  uv run python gym_env/prepare.py      (re-run after changing prices or limits in config.yaml)

Writes gym_env/environments/fieldtwin/data/:
  dev.jsonl      20 dev seasons (UFGA 1990-2009): tune on these
  test.jsonl     15 held-out seasons (UFGA 2010-2024): run once at the end, never for tuning
  example.jsonl  the first 3 dev seasons (smoke checks)

Each row is one season: the system prompt, the tool schemas (Responses API format),
and the task fields (task_id, site, year, split) that the resources server reads.
"""

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "environments" / "fieldtwin" / "data"
AGENT_REF = {"type": "responses_api_agents", "name": "fieldtwin_gymnasium_agent"}

SYSTEM_PROMPT = """You manage one maize field in Gainesville, Florida for one season, one decision per week.
Each week, read what you need with the tools, then call submit_decision exactly once with
nitrogen (n_kg_ha, 0-{max_n_week:g} per week, at most {max_n_season:g} per season) and irrigation (irr_mm, 0-{max_irr:g}).
The action is applied on day 1 of the week and the simulator runs 7 days.
The season ends at crop maturity (about 19-20 weeks). Your score is
profit = grain * {maize:g} USD/kg - nitrogen * {n_price:g} USD/kg - water * {water:g} USD/mm,
minus {leach:g} USD per kg of nitrate leached.
Nitrogen applied right before heavy rain leaches. The weather outlook is noisy."""


def system_prompt() -> str:
    """Limits and prices come from config.yaml so the prompt matches the env's scoring."""
    cfg = yaml.safe_load((ROOT / "config.yaml").read_text())
    env, prices = cfg["env"], cfg["prices"]
    return SYSTEM_PROMPT.format(
        max_n_week=env["max_n_kg_ha_per_week"], max_n_season=env["max_n_kg_ha_per_season"],
        max_irr=env["max_irr_mm_per_week"], maize=prices["maize_usd_per_kg"], n_price=prices["n_usd_per_kg"],
        water=prices["water_usd_per_mm_ha"], leach=cfg["reward"]["leach_penalty_usd_per_kg"])


def responses_tools() -> list[dict]:
    """agents/tools.json uses the Chat Completions shape {"type", "function": {...}};
    the Responses API wants the function fields at the top level, and requires `strict`."""
    tools = json.loads((ROOT / "agents" / "tools.json").read_text())
    return [{"type": "function", **t["function"], "strict": False} for t in tools]


def row(task: dict, tools: list[dict], prompt: str) -> dict:
    user = f"Season {task['task_id']}: site {task['site']}, year {task['year']}. Start with week 0."
    return {
        "responses_create_params": {
            "input": [{"role": "system", "content": prompt}, {"role": "user", "content": user}],
            "tools": tools,
            "parallel_tool_calls": False,
        },
        "agent_ref": AGENT_REF,
        "task_id": task["task_id"],
        "site": task["site"],
        "year": task["year"],
        "split": task["split"],
    }


def main() -> None:
    tools, prompt = responses_tools(), system_prompt()
    OUT.mkdir(parents=True, exist_ok=True)
    splits = {}
    for split in ("dev", "test"):
        tasks = [json.loads(line) for line in (ROOT / "tasks" / f"{split}.jsonl").read_text().splitlines() if line.strip()]
        splits[split] = [row(t, tools, prompt) for t in tasks]
    splits["example"] = splits["dev"][:3]
    for name, rows in splits.items():
        path = OUT / f"{name}.jsonl"
        path.write_text("".join(json.dumps(r) + "\n" for r in rows))
        print(f"{path.relative_to(ROOT)}: {len(rows)} seasons")


if __name__ == "__main__":
    main()
