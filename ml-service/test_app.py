"""Tests for the ML service.  Run:  cd ml-service && python -m pytest -q   (or: python test_app.py)"""
from fastapi.testclient import TestClient

from app import app

FULL = {"age": 63, "sex": 1, "cp": 4, "trestbps": 145, "chol": 233, "fbs": 1, "restecg": 2,
        "thalach": 150, "exang": 1, "oldpeak": 2.3, "slope": 3, "ca": 2, "thal": 7}
HEALTHY = {"age": 41, "sex": 0, "cp": 2, "trestbps": 118, "chol": 190, "fbs": 0, "restecg": 0,
           "thalach": 172, "exang": 0, "oldpeak": 0, "slope": 1, "ca": 0, "thal": 3}
MINIMAL = {k: FULL[k] for k in ("age", "sex", "cp", "trestbps", "chol")}


def test_all():
    with TestClient(app) as c:
        assert c.get("/health").json()["modelLoaded"] is True

        hi = c.post("/predict", json=FULL).json()
        lo = c.post("/predict", json=HEALTHY).json()
        assert 0 <= lo["probability"] < hi["probability"] <= 1
        assert len(hi["factors"]) == 13 and hi["missingFields"] == []
        assert abs(hi["factors"][0]["impact"]) >= abs(hi["factors"][-1]["impact"])

        mini = c.post("/predict", json=MINIMAL).json()
        assert 0 <= mini["probability"] <= 1
        assert len(mini["missingFields"]) == 8 and len(mini["factors"]) == 5

        batch = c.post("/predict/batch", json=[FULL, HEALTHY, MINIMAL]).json()
        assert len(batch) == 3
        assert batch[0]["probability"] == hi["probability"]
        assert batch[1]["probability"] == lo["probability"]
        assert c.post("/predict/batch", json=[]).json() == []

        assert c.post("/predict", json={**FULL, "thal": 5}).status_code == 422
        assert c.post("/predict", json={**FULL, "age": 500}).status_code == 422
        assert c.post("/predict", json={"age": 50}).status_code == 422

        info = c.get("/model-info").json()
        assert "baseline" not in info and info["test"]["auc"] > 0.5


if __name__ == "__main__":
    test_all()
    print("ML service tests passed")
