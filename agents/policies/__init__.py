"""Policy registry: config name -> policy class.

B adds single, multi, multi_no_critic, ... here (and to config.yaml eval.configs).
"""

from agents.policies.base import Decision, Policy
from agents.policies.farmer import Farmer
from agents.policies.farmer_ufga import FarmerUFGA
from agents.policies.nemotron_stub import NemotronStub
from agents.policies.no_n import NoN
from agents.policies.single import Single
from agents.policies.multi import Multi, MultiNoCritic, MultiNoWeather, MultiNoTools

POLICIES: dict[str, type[Policy]] = {
    "no_n": NoN,
    "farmer": Farmer,
    "farmer_ufga": FarmerUFGA,
    "nemotron_stub": NemotronStub,
    "single": Single,
    "multi": Multi,
    "multi_no_critic": MultiNoCritic,
    "multi_no_weather": MultiNoWeather,
    "multi_no_tools": MultiNoTools,
}


def make_policy(name: str) -> Policy:
    if name not in POLICIES:
        raise ValueError(f"unknown policy {name!r}; known: {sorted(POLICIES)}")
    return POLICIES[name]()


__all__ = ["Decision", "Policy", "POLICIES", "make_policy"]
