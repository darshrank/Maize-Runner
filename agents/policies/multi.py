"""Five-role Nemotron team and controlled ablations."""
from agents.policies.nemotron import NemotronPolicy


class Multi(NemotronPolicy):
    name = "multi"


class MultiNoCritic(NemotronPolicy):
    name = "multi_no_critic"


class MultiNoWeather(NemotronPolicy):
    name = "multi_no_weather"


class MultiNoTools(NemotronPolicy):
    name = "multi_no_tools"
