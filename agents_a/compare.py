"""One table of every design against the frozen baselines, per subset (dev-tune, dev-check, test).

  uv run python -m agents_a.compare            # prints markdown; also writes agents_a/comparison.md

Means use only seasons a design actually ran; baselines are averaged over the same seasons, so each row's
gap closed = (design - farmer practice) / (hindsight - farmer practice) is a like-for-like comparison.
"""

import statistics as st
from pathlib import Path

import yaml

from agents_a.common.splits import subset_of
from agents_a.designs import DESIGNS
from eval.run_eval import read_rows

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    cfg = yaml.safe_load((ROOT / "config.yaml").read_text())
    practice = cfg["eval"].get("farmer_practice", "farmer")
    base = {(r["config"], r["task_id"]): r for r in read_rows(ROOT / "results_baseline" / "eval.csv")}
    lines = ["# Agent designs vs baselines", "",
             f"Farmer practice = `{practice}`. Baselines are averaged over the same seasons as each design.", "",
             "| design | subset | seasons | reward | farmer practice | hindsight | gap closed | wins vs farmer | "
             "N kg/ha | irrigation mm | leached kg/ha | fallbacks |",
             "|---" * 12 + "|"]
    for design in DESIGNS:
        rows = read_rows(ROOT / "agents_a" / "designs" / design / "results" / "eval.csv")
        for subset in ("dev-tune", "dev-check", "test"):
            sub = [r for r in rows if subset_of(r) == subset]
            if not sub:
                continue
            mean = lambda rs, k: st.mean(float(r[k]) for r in rs)
            farmer = [base[(practice, r["task_id"])] for r in sub]
            ceiling = [base[("hindsight", r["task_id"])] for r in sub]
            reward, f, h = mean(sub, "reward"), mean(farmer, "reward"), mean(ceiling, "reward")
            gap = (reward - f) / (h - f) if h != f else float("nan")
            wins = sum(float(r["reward"]) > float(fr["reward"]) for r, fr in zip(sub, farmer))
            lines.append(f"| {design} | {subset} | {len(sub)} | {reward:.0f} | {f:.0f} | {h:.0f} | {gap:.2f} | "
                         f"{wins}/{len(sub)} | {mean(sub, 'n_applied'):.0f} | {mean(sub, 'irr_mm'):.0f} | "
                         f"{mean(sub, 'n_leached'):.1f} | {sum(int(r['fallbacks']) for r in sub)} |")
    text = "\n".join(lines) + "\n"
    (ROOT / "agents_a" / "comparison.md").write_text(text)
    print(text)


if __name__ == "__main__":
    main()
