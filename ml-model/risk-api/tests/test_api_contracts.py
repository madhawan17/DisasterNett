from fastapi.testclient import TestClient
from app import app

client = TestClient(app)

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_analyze_risk_schema_validation():
    # Missing bbox should fail validation
    response = client.post("/analyze/risk", json={
        "region": {
            "center": {"lat": 10.0, "lon": 76.0}
        }
    })
    assert response.status_code == 422


def test_analyze_risk_returns_fused_operational_score(monkeypatch):
    monkeypatch.setattr("app.init_gee", lambda: None)
    monkeypatch.setattr(
        "app.find_districts",
        lambda bbox: [{
            "name": "Alpha District",
            "ee_geom": object(),
            "bbox": [72.8, 18.9, 72.9, 19.0],
            "center": {"lat": 18.95, "lon": 72.85},
            "area_km2": 42.0,
        }],
    )
    monkeypatch.setattr("app.get_population", lambda geom: 250000)
    monkeypatch.setattr("app.get_rainfall", lambda geom, days_back=30: 180.0)
    monkeypatch.setattr("app.get_land_cover_stats", lambda geom: {"urban": 0.42, "water": 0.08, "crop": 0.18})
    monkeypatch.setattr(
        "app._get_forecast_signal",
        lambda center, forecast_days: {
            "available": True,
            "overall_max_prob": 0.71,
            "overall_alert_level": "HIGH",
            "peak_day": 2,
            "peak_date": "2026-03-15",
            "daily_forecasts": [{"day": 1, "max_prob": 0.61}, {"day": 2, "max_prob": 0.71}],
        },
    )
    monkeypatch.setattr(
        "app._get_latest_detection_signal",
        lambda bbox: {
            "available": True,
            "flood_percentage": 9.5,
            "confidence_avg": 0.82,
            "zones_count": 4,
            "mean_db_drop": -1.9,
            "population_exposed": 5500,
            "bbox_overlap_ratio": 0.66,
            "analysis_date": "2026-03-13",
        },
    )

    response = client.post("/analyze/risk", json={
        "region": {
            "center": {"lat": 18.95, "lon": 72.85},
            "bbox": [72.8, 18.9, 72.9, 19.0],
            "display_name": "Alpha District",
        },
        "forecast_days": 5,
        "infrastructure_overrides": [{
            "area_name": "Alpha District",
            "critical_assets_exposed": 2,
            "facilities_cut_off": 1,
            "road_access_disruption_index": 0.3,
        }],
    })

    assert response.status_code == 200
    payload = response.json()
    summary = payload["district_summaries"][0]

    assert summary["risk_score"] == summary["operational_score"]
    assert summary["risk_classification"] == summary["operational_classification"]
    assert summary["risk_level"] == "High"
    assert summary["alerts"]
    assert summary["fused_factors"]
    assert summary["component_scores"]["forecast"] > 0
    assert summary["weighted_contributions"]["forecast"] > 0
    assert summary["detection_summary"]["analysis_date"] == "2026-03-13"
    assert summary["explanation"]
    assert payload["enhanced_risk_modeling"]["risk_assessment"]["operational_index"] == summary["risk_score"]
