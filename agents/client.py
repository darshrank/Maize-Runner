"""Small httpx client for the env HTTP API (see SKELETON_SPEC.md section 7)."""

import httpx


class EnvClient:
    def __init__(self, base_url: str = "http://localhost:9000", timeout: float = 30.0):
        self.http = httpx.Client(base_url=base_url, timeout=timeout)

    def health(self) -> dict:
        return self._json(self.http.get("/health"))

    def reset(self, task: dict) -> dict:
        body = {k: task[k] for k in ("task_id", "site", "weather_seed")}
        return self._json(self.http.post("/reset", json=body))

    def step(self, episode_id: str, n_kg_ha: float, irr_mm: float, reason: str = "") -> dict:
        body = {"episode_id": episode_id, "n_kg_ha": n_kg_ha, "irr_mm": irr_mm, "reason": reason}
        return self._json(self.http.post("/step", json=body))

    def tool(self, name: str, episode_id: str) -> dict | list:
        """Call a read tool. A 404 body ({"error": ...}) is returned, not raised,
        so an LLM agent can read the message and fix its call."""
        r = self.http.get(f"/tool/{name}", params={"episode_id": episode_id})
        if r.status_code == 404:
            return r.json()
        return self._json(r)

    def close(self) -> None:
        self.http.close()

    @staticmethod
    def _json(r: httpx.Response):
        r.raise_for_status()
        return r.json()
