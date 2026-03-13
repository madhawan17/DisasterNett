from criticality import calculate_criticality_index, calculate_risk_score


def test_criticality_critical_when_hazard_and_exposure_are_both_high():
    result = calculate_criticality_index(
        population=4_500_000,
        rainfall_mm=800.0,
        land_cover={"urban": 0.8, "water": 0.1, "forest": 0.05},
        forecast_signal={
            "available": True,
            "overall_max_prob": 0.88,
            "peak_day": 1,
            "peak_date": "2026-03-14",
            "overall_alert_level": "CRITICAL",
            "daily_forecasts": [{"day": 1, "max_prob": 0.88}],
        },
        detection_signal={
            "available": True,
            "flood_percentage": 18.5,
            "confidence_avg": 0.84,
            "zones_count": 6,
            "mean_db_drop": -2.4,
            "population_exposed": 120000,
            "bbox_overlap_ratio": 0.72,
            "analysis_date": "2026-03-13",
        },
    )
    assert result["score"] >= 75
    assert result["classification"] == "CRITICAL"
    assert any(f["key"] == "current_flood_detection" for f in result["factors"])
    assert "SAR detection shows active inundation in the area" in result["reasons"]


def test_criticality_low_when_all_inputs_are_muted():
    score, cls, factors = calculate_risk_score(
        population=10_000,
        rainfall_mm=10.0,
        land_cover={"urban": 0.05, "forest": 0.9},
    )
    assert score < 25
    assert cls == "LOW"
    assert factors
