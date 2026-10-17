"""Single Nemotron coordinator with all read tools."""
from agents.policies.nemotron import NemotronPolicy


class Single(NemotronPolicy):
    name = "single"
