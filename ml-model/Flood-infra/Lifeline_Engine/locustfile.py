"""
locustfile.py — Sustained load test for the Lifeline Engine API (Locust).

Runs a realistic mix of traffic:
  - 70%  POST /analyze  (valid Navi Mumbai coords, varied facility types)
  - 15%  GET  /health
  - 10%  POST /analyze  (invalid coords — expect 422)
  -  5%  POST /simulate (expensive — low weight)

Usage
-----
    # Headless: 10 users, spawn 2/s, run 60 s
    locust -f Lifeline_Engine/locustfile.py \
           --headless -u 10 -r 2 -t 60s \
           --host http://localhost:8000

    # Web UI (opens http://localhost:8089)
    locust -f Lifeline_Engine/locustfile.py --host http://localhost:8000
"""

from __future__ import annotations

import random
from typing import Any, Dict, Optional, Tuple

from locust import HttpUser, between, task

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_ORIGIN_POINTS: list[Tuple[float, float]] = [
    (19.0330, 73.0297),
    (19.0388, 73.0166),
    (19.0613, 72.9987),
    (18.9813, 73.0983),
    (19.0773, 73.0117),
    (19.1538, 72.9990),
    (19.0489, 73.0122),
    (19.0166, 73.0421),
    (19.0424, 73.0679),
    (19.0727, 73.0072),
]

_FACILITY_TYPES = ["hospital", "police", "fire_station"]

_FLOOD_SCENARIOS = [
    {"center_lat": 19.0330, "center_lon": 73.0297, "radius_m": 500},
    {"center_lat": 19.0388, "center_lon": 73.0166, "radius_m": 800},
    {"center_lat": 18.9813, "center_lon": 73.0983, "radius_m": 300},
]


def _analyze_payload(
    ftype: Optional[str] = None,
    flood: Optional[Dict] = None,
) -> Dict[str, Any]:
    lat, lon = random.choice(_ORIGIN_POINTS)
    payload: Dict[str, Any] = {
        "point_a": {"lat": lat, "lon": lon},
        "facility_type": ftype or random.choice(_FACILITY_TYPES),
        "place_name": "Navi Mumbai, India",
    }
    if flood is not False:
        payload["flood"] = flood or random.choice(_FLOOD_SCENARIOS)
    return payload


# ---------------------------------------------------------------------------
# User classes
# ---------------------------------------------------------------------------

class LifelineUser(HttpUser):
    """Simulates a realistic mix of API consumers."""

    # Think time between requests: 1–5 s (simulates real users)
    wait_time = between(1, 5)

    # ------------------------------------------------------------------
    # /analyze — valid requests (high frequency)
    # ------------------------------------------------------------------

    @task(35)
    def analyze_hospital(self) -> None:
        self.client.post(
            "/analyze",
            json=_analyze_payload(ftype="hospital"),
            name="/analyze [hospital]",
        )

    @task(20)
    def analyze_police(self) -> None:
        self.client.post(
            "/analyze",
            json=_analyze_payload(ftype="police"),
            name="/analyze [police]",
        )

    @task(15)
    def analyze_fire_station(self) -> None:
        self.client.post(
            "/analyze",
            json=_analyze_payload(ftype="fire_station"),
            name="/analyze [fire_station]",
        )

    # ------------------------------------------------------------------
    # /health — lightweight probe (medium frequency)
    # ------------------------------------------------------------------

    @task(15)
    def health_check(self) -> None:
        self.client.get("/health", name="/health")

    # ------------------------------------------------------------------
    # /analyze — invalid inputs (tests 422 handling, low frequency)
    # ------------------------------------------------------------------

    @task(6)
    def analyze_bad_boundary(self) -> None:
        """Boundary-extreme coords — must return 422, not 500."""
        with self.client.post(
            "/analyze",
            json={
                "point_a": {"lat": -90, "lon": -180},
                "facility_type": "hospital",
                "place_name": "Navi Mumbai, India",
            },
            name="/analyze [invalid:boundary]",
            catch_response=True,
        ) as resp:
            if resp.status_code == 422:
                resp.success()
            else:
                resp.failure(f"Expected 422 for boundary coords, got {resp.status_code}")

    @task(4)
    def analyze_bad_out_of_bounds(self) -> None:
        """Coords in Delhi — must return 422 (outside bounding box)."""
        with self.client.post(
            "/analyze",
            json={
                "point_a": {"lat": 28.6139, "lon": 77.2090},
                "facility_type": "hospital",
                "place_name": "Navi Mumbai, India",
            },
            name="/analyze [invalid:out-of-bounds]",
            catch_response=True,
        ) as resp:
            if resp.status_code == 422:
                resp.success()
            else:
                resp.failure(f"Expected 422 for out-of-bounds coords, got {resp.status_code}")

    @task(3)
    def analyze_bad_facility_type(self) -> None:
        """Unknown facility type — must return 422."""
        with self.client.post(
            "/analyze",
            json={
                "point_a": {"lat": 19.0330, "lon": 73.0297},
                "facility_type": "supermarket",
                "place_name": "Navi Mumbai, India",
            },
            name="/analyze [invalid:facility_type]",
            catch_response=True,
        ) as resp:
            if resp.status_code == 422:
                resp.success()
            else:
                resp.failure(f"Expected 422 for bad facility_type, got {resp.status_code}")

    # ------------------------------------------------------------------
    # /simulate — expensive, low frequency
    # ------------------------------------------------------------------

    @task(2)
    def simulate(self) -> None:
        self.client.post(
            "/simulate",
            json={
                "place_name": "Navi Mumbai, India",
                "flood": random.choice(_FLOOD_SCENARIOS),
                "save_to_disk": False,
            },
            name="/simulate",
        )
