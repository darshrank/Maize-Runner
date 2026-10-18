"""d1b_multi: the d1_multi team flow with corrected prompts (see README.md for what changed and why)."""

from pathlib import Path

from agents_a.designs.d1_multi.policy import MultiAgent


class MultiAgentB(MultiAgent):
    name = "a_d1b_multi"
    prompt_dir = Path(__file__).resolve().parent / "prompts"
