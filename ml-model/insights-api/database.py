"""database.py -- NeonDB (PostgreSQL) schema and CRUD for historical flood runs."""

import os
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")

# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------

def _get_conn():
    """Return a new psycopg2 connection using the DATABASE_URL env var."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL not set -- cannot connect to NeonDB")
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


# ---------------------------------------------------------------------------
# Schema bootstrap
# ---------------------------------------------------------------------------

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location        TEXT NOT NULL,
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    bbox            DOUBLE PRECISION[4],
    analysis_date   DATE,
    status          TEXT DEFAULT 'queued',
    progress        INTEGER DEFAULT 0,

    -- Results (populated on completion)
    flood_area_km2      DOUBLE PRECISION,
    flood_percentage    DOUBLE PRECISION,
    mean_db_drop        DOUBLE PRECISION,
    population_exposed  INTEGER,
    confidence_avg      DOUBLE PRECISION,
    zones_count         INTEGER,
    sar_image_url       TEXT,
    ai_insight          TEXT,
    result_json         JSONB,

    -- Metadata
    processing_time_s   DOUBLE PRECISION,
    sensor              TEXT DEFAULT 'S1_GRD',
    detector            TEXT DEFAULT 'sar_logratio',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    error               TEXT
);

CREATE TABLE IF NOT EXISTS flood_patches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID REFERENCES runs(id) ON DELETE CASCADE,
    zone_id         TEXT,
    severity        TEXT,
    area_km2        DOUBLE PRECISION,
    avg_depth_m     DOUBLE PRECISION,
    max_depth_m     DOUBLE PRECISION,
    population_exposed INTEGER,
    confidence      DOUBLE PRECISION,
    centroid_lat    DOUBLE PRECISION,
    centroid_lon    DOUBLE PRECISION,
    bbox            DOUBLE PRECISION[4],
    admin_name      TEXT,
    geometry        JSONB
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patches_run ON flood_patches(run_id);
"""


def ensure_schema():
    """Create tables if they don't exist."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(_SCHEMA_SQL)
        conn.commit()
    print("[database] Schema ensured")


# ---------------------------------------------------------------------------
# CRUD -- Runs
# ---------------------------------------------------------------------------

def create_run(
    location: str,
    lat: float,
    lon: float,
    bbox: Optional[List[float]],
    analysis_date: Optional[str],
) -> str:
    """Insert a new run row and return its UUID."""
    run_id = str(uuid.uuid4())
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO runs (id, location, lat, lon, bbox, analysis_date, status)
                VALUES (%s, %s, %s, %s, %s, %s, 'queued')
                """,
                (run_id, location, lat, lon, bbox, analysis_date),
            )
        conn.commit()
    return run_id


def update_run_status(run_id: str, status: str, progress: int = 0, error: Optional[str] = None):
    """Update run status and optional progress/error."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE runs SET status = %s, progress = %s, error = %s
                WHERE id = %s
                """,
                (status, progress, error, run_id),
            )
        conn.commit()


def save_results(
    run_id: str,
    flood_area_km2: float,
    flood_percentage: float,
    mean_db_drop: float,
    population_exposed: int,
    confidence_avg: float,
    zones_count: int,
    sar_image_url: str,
    ai_insight: str,
    result_json: Dict[str, Any],
    processing_time_s: float,
    patches: List[Dict[str, Any]],
):
    """Persist completed analysis results and associated flood patches."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE runs SET
                    status = 'completed',
                    progress = 100,
                    flood_area_km2 = %s,
                    flood_percentage = %s,
                    mean_db_drop = %s,
                    population_exposed = %s,
                    confidence_avg = %s,
                    zones_count = %s,
                    sar_image_url = %s,
                    ai_insight = %s,
                    result_json = %s,
                    processing_time_s = %s
                WHERE id = %s
                """,
                (
                    flood_area_km2, flood_percentage, mean_db_drop,
                    population_exposed, confidence_avg, zones_count,
                    sar_image_url, ai_insight,
                    json.dumps(result_json), processing_time_s,
                    run_id,
                ),
            )

            # Insert flood patches
            for p in patches:
                cur.execute(
                    """
                    INSERT INTO flood_patches
                        (run_id, zone_id, severity, area_km2, avg_depth_m, max_depth_m,
                         population_exposed, confidence, centroid_lat, centroid_lon,
                         bbox, admin_name, geometry)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        run_id, p["zone_id"], p["severity"], p["area_km2"],
                        p["avg_depth_m"], p["max_depth_m"],
                        p.get("population_exposed", 0), p["confidence"],
                        p["centroid"]["lat"], p["centroid"]["lon"],
                        p.get("bbox"), p.get("admin_name", ""),
                        json.dumps(p.get("geometry")),
                    ),
                )
        conn.commit()


def get_run(run_id: str) -> Optional[Dict[str, Any]]:
    """Fetch a single run with its patches."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM runs WHERE id = %s", (run_id,))
            run = cur.fetchone()
            if not run:
                return None

            run = dict(run)
            # Convert datetime / UUID to string
            for k, v in run.items():
                if isinstance(v, (datetime, uuid.UUID)):
                    run[k] = str(v)

            # Fetch patches
            cur.execute(
                "SELECT * FROM flood_patches WHERE run_id = %s ORDER BY area_km2 DESC",
                (run_id,),
            )
            patches = []
            for row in cur.fetchall():
                row = dict(row)
                for k, v in row.items():
                    if isinstance(v, (datetime, uuid.UUID)):
                        row[k] = str(v)
                patches.append(row)
            run["patches"] = patches
            return run


def list_runs(limit: int = 50) -> List[Dict[str, Any]]:
    """Return recent runs (without full result_json for brevity)."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, location, lat, lon, analysis_date, status,
                       flood_area_km2, flood_percentage, mean_db_drop,
                       population_exposed, zones_count, sensor, detector,
                       processing_time_s, created_at, error
                FROM runs
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = []
            for row in cur.fetchall():
                row = dict(row)
                for k, v in row.items():
                    if isinstance(v, (datetime, uuid.UUID)):
                        row[k] = str(v)
                rows.append(row)
            return rows
