"""
test_load.py — Async burst load test for the Lifeline Engine API.

Fires N concurrent requests and reports latency percentiles, throughput,
and per-status-code counts.  No external tool needed — just httpx.

Usage
-----
    # Basic: 20 concurrent users, 3 rounds each (60 total requests)
    python test_load.py

    # Custom: 50 users, 5 rounds, target a different host
    python test_load.py --users 50 --rounds 5 --base-url http://localhost:8000

    # Only test /analyze
    python test_load.py --endpoint analyze

    # Verbose: print every response body
    python test_load.py --verbose
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import httpx

# ---------------------------------------------------------------------------
# Test fixtures — real Navi Mumbai coordinates spread across the city
# ---------------------------------------------------------------------------

# (lat, lon, description)
ORIGIN_POINTS: List[Tuple[float, float, str]] = [
    (19.0330, 73.0297, "Vashi CBD centre"),
    (19.0388, 73.0166, "Nerul node"),
    (19.0613, 72.9987, "Airoli sector"),
    (18.9813, 73.0983, "Kalamboli junction"),
    (19.0773, 73.0117, "Ghansoli"),
    (19.1538, 72.9990, "Airoli Bridge end"),
    (19.0489, 73.0122, "Koparkhairane"),
    (19.0166, 73.0421, "CBD Belapur"),
    (19.0424, 73.0679, "Kharghar sector 7"),
    (19.0727, 73.0072, "Turbhe"),
]

FACILITY_TYPES = ["hospital", "police", "fire_station"]

FLOOD_SCENARIOS = [
    {"center_lat": 19.0330, "center_lon": 73.0297, "radius_m": 500},
    {"center_lat": 19.0388, "center_lon": 73.0166, "radius_m": 800},
    {"center_lat": 18.9813, "center_lon": 73.0983, "radius_m": 300},
    None,  # no flood (baseline only effectively)
]


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class RequestResult:
    endpoint: str
    status_code: int
    latency_ms: float
    response_status: Optional[str] = None   # FULLY_ACCESSIBLE / LIMITED_ACCESS / CUT_OFF
    warnings: List[str] = field(default_factory=list)
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Request builders
# ---------------------------------------------------------------------------

def _build_analyze_payload() -> Dict[str, Any]:
    lat, lon, _ = random.choice(ORIGIN_POINTS)
    ftype = random.choice(FACILITY_TYPES)
    flood = random.choice(FLOOD_SCENARIOS)
    payload: Dict[str, Any] = {
        "point_a": {"lat": lat, "lon": lon},
        "facility_type": ftype,
        "place_name": "Navi Mumbai, India",
    }
    if flood:
        payload["flood"] = flood
    return payload


def _build_bad_payload_boundary() -> Dict[str, Any]:
    """Deliberately invalid — expect 422."""
    return {
        "point_a": {"lat": -90, "lon": -180},
        "facility_type": "hospital",
        "place_name": "Navi Mumbai, India",
    }


def _build_bad_payload_out_of_bounds() -> Dict[str, Any]:
    """Point far outside Navi Mumbai — expect 422."""
    return {
        "point_a": {"lat": 28.6139, "lon": 77.2090},   # New Delhi
        "facility_type": "hospital",
        "place_name": "Navi Mumbai, India",
    }


# ---------------------------------------------------------------------------
# Single async request
# ---------------------------------------------------------------------------

async def _fire(
    client: httpx.AsyncClient,
    base_url: str,
    endpoint: str,
    payload: Optional[Dict] = None,
) -> RequestResult:
    url = f"{base_url}/{endpoint}"
    t0 = time.perf_counter()
    try:
        if payload is None:
            resp = await client.get(url)
        else:
            resp = await client.post(url, json=payload)
        latency_ms = (time.perf_counter() - t0) * 1000
        body: Dict = {}
        try:
            body = resp.json()
        except Exception:
            pass
        return RequestResult(
            endpoint=endpoint,
            status_code=resp.status_code,
            latency_ms=latency_ms,
            response_status=body.get("status"),
            warnings=body.get("warnings", []),
        )
    except Exception as exc:
        latency_ms = (time.perf_counter() - t0) * 1000
        return RequestResult(
            endpoint=endpoint,
            status_code=0,
            latency_ms=latency_ms,
            error=str(exc),
        )


# ---------------------------------------------------------------------------
# Test scenarios
# ---------------------------------------------------------------------------

async def run_burst(
    base_url: str,
    n_users: int,
    rounds: int,
    endpoint_filter: Optional[str],
    verbose: bool,
    timeout: float,
) -> List[RequestResult]:
    """Fire all requests concurrently and collect results."""

    tasks = []

    # Build request list
    payloads_and_endpoints: List[Tuple[str, Optional[Dict]]] = []

    for _ in range(rounds):
        for _ in range(n_users):
            ep = endpoint_filter or random.choice(["analyze", "analyze", "analyze", "health"])
            if ep == "health":
                payloads_and_endpoints.append(("health", None))
            elif ep == "analyze":
                choice = random.random()
                if choice < 0.75:
                    payloads_and_endpoints.append(("analyze", _build_analyze_payload()))
                elif choice < 0.88:
                    payloads_and_endpoints.append(("analyze", _build_bad_payload_boundary()))
                else:
                    payloads_and_endpoints.append(("analyze", _build_bad_payload_out_of_bounds()))
            else:
                payloads_and_endpoints.append((ep, _build_analyze_payload()))

    total = len(payloads_and_endpoints)
    print(f"\nFiring {total} requests ({n_users} concurrent × {rounds} rounds) → {base_url}")
    print("─" * 60)

    limits = httpx.Limits(max_connections=n_users + 5, max_keepalive_connections=n_users)
    async with httpx.AsyncClient(
        base_url=base_url,
        timeout=timeout,
        limits=limits,
    ) as client:
        tasks = [
            _fire(client, base_url, ep, payload)
            for ep, payload in payloads_and_endpoints
        ]
        results = await asyncio.gather(*tasks)

    if verbose:
        for r in results:
            tag = f"[{r.status_code}]"
            body_status = f" → {r.response_status}" if r.response_status else ""
            warn_tag = f" ⚠ {len(r.warnings)} warning(s)" if r.warnings else ""
            err_tag  = f" ✗ {r.error}" if r.error else ""
            print(f"  {r.endpoint:<12} {tag:<6} {r.latency_ms:>8.1f} ms{body_status}{warn_tag}{err_tag}")

    return list(results)


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def _print_report(results: List[RequestResult]) -> None:
    total = len(results)
    if total == 0:
        print("No results.")
        return

    latencies = [r.latency_ms for r in results]
    errors    = [r for r in results if r.error or r.status_code == 0]
    by_code: Dict[int, int] = {}
    by_status: Dict[str, int] = {}
    total_warnings = 0

    for r in results:
        by_code[r.status_code] = by_code.get(r.status_code, 0) + 1
        if r.response_status:
            by_status[r.response_status] = by_status.get(r.response_status, 0) + 1
        total_warnings += len(r.warnings)

    latencies.sort()
    p50  = statistics.median(latencies)
    p90  = latencies[int(len(latencies) * 0.90)]
    p99  = latencies[int(len(latencies) * 0.99)]
    mean = statistics.mean(latencies)
    mn   = min(latencies)
    mx   = max(latencies)

    success_rate = 100 * sum(1 for r in results if 200 <= r.status_code < 300) / total

    print("\n" + "═" * 60)
    print("  LOAD TEST RESULTS")
    print("═" * 60)
    print(f"  Total requests : {total}")
    print(f"  Success rate   : {success_rate:.1f}%")
    print(f"  Network errors : {len(errors)}")
    print(f"  Total warnings : {total_warnings}")
    print()
    print("  Latency (ms)")
    print(f"    min   : {mn:>8.1f}")
    print(f"    mean  : {mean:>8.1f}")
    print(f"    p50   : {p50:>8.1f}")
    print(f"    p90   : {p90:>8.1f}")
    print(f"    p99   : {p99:>8.1f}")
    print(f"    max   : {mx:>8.1f}")
    print()
    print("  HTTP status codes")
    for code, count in sorted(by_code.items()):
        bar = "█" * min(count, 40)
        print(f"    {code}  {count:>5}  {bar}")
    if by_status:
        print()
        print("  Accessibility states (2xx responses)")
        for st, count in sorted(by_status.items()):
            print(f"    {st:<22} {count:>5}")
    print("═" * 60)

    # Fail if success rate is below threshold
    if success_rate < 90.0:
        print(f"\n  ✗ FAIL — success rate {success_rate:.1f}% < 90% threshold")
        sys.exit(1)
    else:
        print(f"\n  ✓ PASS — success rate {success_rate:.1f}%")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Lifeline Engine API load test")
    p.add_argument("--base-url",  default="http://localhost:8000", help="API base URL")
    p.add_argument("--users",     type=int,   default=20,    help="Concurrent users per round")
    p.add_argument("--rounds",    type=int,   default=3,     help="Number of rounds")
    p.add_argument("--timeout",   type=float, default=120.0, help="Per-request timeout (s)")
    p.add_argument("--endpoint",  default=None, choices=["analyze", "health", "simulate"],
                   help="Lock all requests to one endpoint")
    p.add_argument("--verbose",   action="store_true", help="Print every response")
    return p.parse_args()


async def _main() -> None:
    args = _parse_args()
    results = await run_burst(
        base_url=args.base_url,
        n_users=args.users,
        rounds=args.rounds,
        endpoint_filter=args.endpoint,
        verbose=args.verbose,
        timeout=args.timeout,
    )
    _print_report(results)


if __name__ == "__main__":
    asyncio.run(_main())
