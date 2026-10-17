"""Baseline: never applies nitrogen or water."""

from agents.policies.base import Decision, Policy


class NoN(Policy):
    name = "no_n"

    def decide(self, episode_id, week, obs, env, log):
        return Decision(0.0, 0.0, "No-N baseline: never fertilize or irrigate.")
