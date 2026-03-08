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
