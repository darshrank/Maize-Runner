"""Policy registry: config name -> policy class.

B adds single, multi, multi_no_critic, ... here (and to config.yaml eval.configs).
"""

from agents.policies.base import Decision, Policy
from agents.policies.farmer import Farmer
from agents.policies.farmer_ufga import FarmerUFGA
from agents.policies.nemotron_stub import NemotronStub
from agents.policies.no_n import NoN

POLICIES: dict[str, type[Policy]] = {
    "no_n": NoN,
    "farmer": Farmer,
    "farmer_ufga": FarmerUFGA,
    "nemotron_stub": NemotronStub,
}


def make_policy(name: str) -> Policy:
    if name not in POLICIES:
        raise ValueError(f"unknown policy {name!r}; known: {sorted(POLICIES)}")
    return POLICIES[name]()


__all__ = ["Decision", "Policy", "POLICIES", "make_policy"]
