"""Registry of A's agent designs. Each design lives in its own folder (policy, prompts, runs, results).

Designs are registered into the shared policy registry at run time (agents_a/run_design.py) as
"a_<design>", so B's agents/policies/__init__.py never has to change.
"""

import importlib

DESIGNS = {
    "d0_single": "agents_a.designs.d0_single.policy:SingleAgent",
    "d1_multi": "agents_a.designs.d1_multi.policy:MultiAgent",
    "d1b_multi": "agents_a.designs.d1b_multi.policy:MultiAgentB",
    "d1c_multi": "agents_a.designs.d1c_multi.policy:MultiAgentC",
    "d0b_single": "agents_a.designs.d0b_single.policy:SingleAgentB",
    "d1d_multi": "agents_a.designs.d1d_multi.policy:MultiAgentD",
}


def load(design: str):
    module, cls = DESIGNS[design].split(":")
    return getattr(importlib.import_module(module), cls)


def register_all() -> None:
    from agents.policies import POLICIES
    for design in DESIGNS:
        POLICIES[f"a_{design}"] = load(design)
