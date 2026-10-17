"""FieldTwin environment: simulator interface, toy simulator, HTTP server.

Simulator factory: config.yaml `env.simulator` picks an entry from SIMULATORS.
To add a simulator, implement env.sim_base.Simulator and register it below.
The server does not need to change.
"""

import importlib

from env.sim_base import Simulator

SIMULATORS = {
    "toy": "env.toy_sim:ToySimulator",
    "dssat": "env.dssat_sim:DssatSimulator",   # needs scripts/install_gym_dssat.sh
}


def make_simulator(name: str, env_config: dict | None = None) -> Simulator:
    """Create a fresh simulator instance by its config name (lazy import)."""
    if name not in SIMULATORS:
        raise ValueError(f"unknown simulator {name!r}; known: {sorted(SIMULATORS)}")
    module_name, class_name = SIMULATORS[name].split(":")
    cls = getattr(importlib.import_module(module_name), class_name)
    return cls(env_config)
