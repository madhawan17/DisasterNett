import pytest
from criticality import calculate_risk_score

def test_criticality_critical():
    score, cls, factors = calculate_risk_score(
        population=4_500_000,
        rainfall_mm=800.0,
        land_cover={"urban": 0.8, "water": 0.1, "forest": 0.05}
    )
    assert score >= 75
    assert cls == "CRITICAL"
    assert "High population density" in factors
    assert "Heavy recent rainfall" in factors

def test_criticality_low():
    score, cls, factors = calculate_risk_score(
        population=10_000,
        rainfall_mm=10.0,
        land_cover={"urban": 0.05, "forest": 0.9}
    )
    assert score < 25
    assert cls == "LOW"
    assert "High population density" not in factors
