from src.risk_mapper import confidence, risk_class


def test_risk_class_boundaries() -> None:
    assert risk_class(0.29) == "Low"
    assert risk_class(0.30) == "Moderate"
    assert risk_class(0.70) == "Moderate"
    assert risk_class(0.71) == "High"


def test_confidence_formula() -> None:
    assert confidence(0.5) == 0.0
    assert confidence(1.0) == 1.0
    assert confidence(0.0) == 1.0

