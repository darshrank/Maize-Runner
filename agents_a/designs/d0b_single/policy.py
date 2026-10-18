"""d0b_single: the d0_single agent loop (ONE Nemotron agent, all tools) with everything the d1c_multi team's prompts
contain merged into one prompt: the same sourced agronomy (common/agronomy.md), the Planner's decision rules and the
Critic's checklist as a self-check. The only difference from d1c_multi is the architecture (one agent vs five roles)."""

from pathlib import Path

import yaml

from agents_a.common.llm import ROOT
from agents_a.designs.d0_single.policy import SingleAgent

HERE = Path(__file__).resolve().parent
AGRONOMY = (HERE.parents[1] / "common" / "agronomy.md").read_text()


def system_prompt() -> str:
    cfg = yaml.safe_load((ROOT / "config.yaml").read_text())
    env, prices = cfg["env"], cfg["prices"]
    return (HERE / "prompts" / "system.md").read_text().format(
        maize=prices["maize_usd_per_kg"], n_price=prices["n_usd_per_kg"], water=prices["water_usd_per_mm_ha"],
        leach=cfg["reward"]["leach_penalty_usd_per_kg"], max_n_week=env["max_n_kg_ha_per_week"],
        max_n_season=env["max_n_kg_ha_per_season"], max_irr=env["max_irr_mm_per_week"], agronomy=AGRONOMY)


class SingleAgentB(SingleAgent):
    name = "a_d0b_single"

    def __init__(self):
        super().__init__()
        self.system = system_prompt()
