"""Contract tests for the FROZEN HTTP API (SKELETON_SPEC.md section 7).

Every test runs against each simulator; dssat is skipped where gym-DSSAT is not installed.
"""

import copy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from env.server import create_app, load_config

DSSAT_INSTALLED = Path(load_config()["env"]["dssat"]["python"]).exists()
SIMULATORS = ["toy", pytest.param("dssat", marks=pytest.mark.skipif(
    not DSSAT_INSTALLED, reason="gym-DSSAT not installed (scripts/install_gym_dssat.sh)"))]

OBS_KEYS = {"day", "week", "stage", "soil_water_frac", "soil_n_kg_ha", "n_applied_total",
            "irr_total_mm", "biomass_kg_ha"}
WEEKLY_KEYS = {"rain_mm", "n_leached", "n_uptake", "n_gas"}
FINAL_KEYS = {"grain_kg_ha", "n_applied", "n_uptake", "n_leached", "n_gas", "irr_mm",
              "profit_usd_ha", "reward"}
WEATHER_DAY_KEYS = {"day", "tmax", "tmin", "rain_mm"}
TASK = {"task_id": "UFGA-2015", "site": "UFGA", "year": 2015}


@pytest.fixture(params=SIMULATORS)
def client(request):
    cfg = copy.deepcopy(load_config())
    cfg["env"]["simulator"] = request.param
    return TestClient(create_app(cfg))


def reset(client) -> dict:
    r = client.post("/reset", json=TASK)
    assert r.status_code == 200
    return r.json()


def tool(client, name, episode_id):
    r = client.get(f"/tool/{name}", params={"episode_id": episode_id})
    assert r.status_code == 200, r.text
    return r.json()


def check_tools(client, eid):
    w = tool(client, "get_weather", eid)
    assert set(w) == {"history", "outlook"}
    assert len(w["history"]) <= 14 and len(w["outlook"]) <= 7
    for day in w["history"] + w["outlook"]:
        assert set(day) == WEATHER_DAY_KEYS
    assert set(tool(client, "get_crop_state", eid)) == {"stage", "gdd", "biomass_kg_ha", "n_stress", "water_stress"}
    assert set(tool(client, "get_soil", eid)) == {"soil_water_frac", "soil_n_kg_ha"}
    for row in tool(client, "get_history", eid):
        assert set(row) == {"week", "n_kg_ha", "irr_mm", "rain_mm", "n_leached", "n_uptake"}
    assert set(tool(client, "get_budget", eid)) == {"n_applied_total", "n_remaining_season_cap",
                                                    "irr_total_mm", "spend_usd"}


def test_health(client):
    body = client.get("/health").json()
    assert body["ok"] is True and body["simulator"] in ("toy", "dssat")


def test_full_season(client):
    r = reset(client)
    assert set(r) == {"episode_id", "obs", "week"} and r["week"] == 0
    assert set(r["obs"]) == OBS_KEYS
    eid = r["episode_id"]
    check_tools(client, eid)

    done, week = False, 0
    while not done:
        s = client.post("/step", json={"episode_id": eid, "n_kg_ha": 20, "irr_mm": 5, "reason": "test"}).json()
        assert {"obs", "week", "done", "weekly", "clamped"} <= set(s)
        assert set(s["obs"]) == OBS_KEYS and set(s["weekly"]) == WEEKLY_KEYS
        assert s["clamped"] is (s["week"] > 15)   # 15 x 20 kg reaches the 300 season cap
        week, done = s["week"], s["done"]
        if week == 3:
            check_tools(client, eid)
            assert len(tool(client, "get_history", eid)) == 3
            assert len(tool(client, "get_weather", eid)["history"]) == 14
    assert 15 <= week <= 20   # dssat ends at crop maturity, toy after 20 weeks
    final = s["final"]
    assert set(final) == FINAL_KEYS
    assert final["n_applied"] == 300   # 20 weeks x 20 kg would be 400; the season cap is 300
    profit = final["grain_kg_ha"] * 0.17 - final["n_applied"] * 0.90 - final["irr_mm"] * 0.50
    assert final["profit_usd_ha"] == pytest.approx(profit, abs=0.02)
    assert final["reward"] == pytest.approx(profit - 2.0 * final["n_leached"], abs=0.02)


def test_outlook_same_for_every_episode(client):
    a, b = reset(client)["episode_id"], reset(client)["episode_id"]
    assert tool(client, "get_weather", a)["outlook"] == tool(client, "get_weather", b)["outlook"]


def test_clamping(client):
    eid = reset(client)["episode_id"]
    s = client.post("/step", json={"episode_id": eid, "n_kg_ha": 500, "irr_mm": -3, "reason": ""}).json()
    assert s["clamped"] is True
    assert s["obs"]["n_applied_total"] == 120 and s["obs"]["irr_total_mm"] == 0
    client.post("/step", json={"episode_id": eid, "n_kg_ha": 120, "irr_mm": 80, "reason": ""})
    s = client.post("/step", json={"episode_id": eid, "n_kg_ha": 120, "irr_mm": 0, "reason": ""}).json()
    assert s["clamped"] is True and s["obs"]["n_applied_total"] == 300   # season cap
    budget = tool(client, "get_budget", eid)
    assert budget["n_remaining_season_cap"] == 0 and budget["irr_total_mm"] == 50


def test_404_messages(client):
    eid = reset(client)["episode_id"]
    r = client.get("/tool/get_rain", params={"episode_id": eid})
    assert r.status_code == 404 and "get_weather" in r.json()["error"]   # lists valid tools
    r = client.get("/tool/get_soil", params={"episode_id": "nope"})
    assert r.status_code == 404 and "/reset" in r.json()["error"]
    r = client.post("/step", json={"episode_id": "nope", "n_kg_ha": 0, "irr_mm": 0, "reason": ""})
    assert r.status_code == 404 and "error" in r.json()


def test_legacy_weather_seed_and_unknown_year(client):
    r = client.post("/reset", json={"task_id": "old", "site": "UFGA", "weather_seed": 3})
    assert r.status_code == 200   # deprecated seed still accepted (maps to a real year)
    r = client.post("/reset", json={"task_id": "x", "site": "UFGA", "year": 1950})
    assert r.status_code == 400 and "available years" in r.json()["error"]


@pytest.mark.parametrize("sim_name", SIMULATORS)
def test_outlook_is_the_real_weather_that_follows(sim_name):
    """With noise off, this week's outlook must equal the weather the season then delivers,
    and that weather must be the NASA POWER data for those dates."""
    import numpy as np
    from env import make_simulator
    from env.weather import PLANTING_DOY, load_year
    sim = make_simulator(sim_name, {**load_config()["env"], "outlook_noise": {"rain_frac": 0.0, "temp_c": 0.0}})
    sim.reset("UFGA", 2015)
    for week in range(3):
        outlook = sim.weather_outlook(7, np.random.default_rng(0))
        sim.step_week(80 if week == 0 else 0, 30)   # management must not change the weather
        assert sim.weather_history(7) == outlook
    real = load_year("UFGA", 2015)[PLANTING_DOY - 1 + 15:PLANTING_DOY - 1 + 22]   # days 15-21 after planting
    assert [w["rain_mm"] for w in outlook] == [d["rain_mm"] for d in real]
    sim.close()
