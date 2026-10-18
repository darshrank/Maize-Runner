"""d1c_multi: the d1_multi team flow with the sourced agronomy (agents_a/common/agronomy.md) given to every role,
and role prompts that follow it (see README.md)."""

from pathlib import Path

from agents_a.designs.d1_multi.policy import MultiAgent, load_prompts

HERE = Path(__file__).resolve().parent
AGRONOMY = (HERE.parents[1] / "common" / "agronomy.md").read_text()


class MultiAgentC(MultiAgent):
    name = "a_d1c_multi"
    prompt_dir = HERE / "prompts"

    def __init__(self):
        super().__init__()
        # Insert the shared, sourced agronomy between the team context and each role's instructions.
        context = load_prompts(self.prompt_dir)
        self.prompts = {role: text.replace("\n\nYou are", f"\n{AGRONOMY}\nYou are", 1) for role, text in context.items()}
