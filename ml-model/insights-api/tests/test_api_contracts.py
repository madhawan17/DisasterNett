from fastapi.testclient import TestClient
from app import app

client = TestClient(app)

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_analyze_endpoint_validation():
    # Missing required region
    response = client.post("/analyze", json={"date": "2026-03-01"})
    assert response.status_code == 422
    
    # Missing bbox in region
    response = client.post("/analyze", json={
        "region": {
            "center": {"lat": 10.0, "lon": 76.0}
        }
    })
    assert response.status_code == 422
