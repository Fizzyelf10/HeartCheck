"""FastAPI wrapper around the trained heart disease model.

Run:  uvicorn app:app --port 8000
The Spring Boot backend calls these endpoints:
    POST /predict     -> probability + per-patient explanation ("factors")
    GET  /model-info  -> model version, algorithm, metrics, global feature importance
    GET  /health
"""
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("MODEL_PATH", HERE / "heart_model.joblib"))
META_PATH = Path(os.getenv("MODEL_META_PATH", HERE / "model_meta.json"))

FEATURES = ["age", "trestbps", "chol", "thalach", "oldpeak",
            "sex", "cp", "fbs", "restecg", "exang", "slope", "ca", "thal"]
LABELS = {
    "age": "Age", "sex": "Sex", "cp": "Chest pain type", "trestbps": "Resting blood pressure",
    "chol": "Cholesterol", "fbs": "Fasting blood sugar", "restecg": "Resting ECG",
    "thalach": "Max heart rate", "exang": "Exercise-induced angina", "oldpeak": "ST depression",
    "slope": "ST slope", "ca": "Blocked major vessels", "thal": "Thalassemia test",
}
state: dict = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    state["model"] = joblib.load(MODEL_PATH)  # load once at startup
    state["meta"] = json.loads(META_PATH.read_text()) if META_PATH.exists() else {"version": "1.0"}
    yield


app = FastAPI(title="HeartCheck ML Service", version="2.0", lifespan=lifespan)


class Patient(BaseModel):
    # Required: things almost anyone knows or can measure at home / at a GP visit.
    age: float = Field(ge=1, le=120)
    sex: Literal[0, 1]
    cp: Literal[1, 2, 3, 4]
    trestbps: float = Field(ge=50, le=300)
    chol: float = Field(ge=50, le=700)
    # Optional: clinical test results. Missing values are imputed by the trained pipeline.
    fbs: Optional[Literal[0, 1]] = None
    restecg: Optional[Literal[0, 1, 2]] = None
    thalach: Optional[float] = Field(default=None, ge=30, le=250)
    exang: Optional[Literal[0, 1]] = None
    oldpeak: Optional[float] = Field(default=None, ge=0, le=10)
    slope: Optional[Literal[1, 2, 3]] = None
    ca: Optional[Literal[0, 1, 2, 3]] = None
    thal: Optional[Literal[3, 6, 7]] = None


class Factor(BaseModel):
    feature: str
    label: str
    value: Optional[float]
    impact: float  # change in probability vs. a typical patient value (positive = raises risk)


class Prediction(BaseModel):
    probability: float
    modelVersion: str
    factors: list[Factor]
    missingFields: list[str]


def explain(model, row: pd.DataFrame, p0: float) -> list[Factor]:
    """Model-agnostic explanation: for every feature, replace the patient's value with the
    typical (median / most common) training value and measure how much the probability drops.
    One batched predict_proba call, so it adds ~1 ms."""
    baseline = state["meta"].get("baseline")
    if not baseline:
        return []
    known = [f for f in FEATURES if not pd.isna(row.at[0, f])]
    if not known:
        return []
    variants = pd.concat([row] * len(known), ignore_index=True)
    for i, f in enumerate(known):
        variants.at[i, f] = baseline[f]
    probs = model.predict_proba(variants)[:, 1]
    factors = [Factor(feature=f, label=LABELS[f], value=float(row.at[0, f]),
                      impact=round(float(p0 - p), 4)) for f, p in zip(known, probs)]
    return sorted(factors, key=lambda x: abs(x.impact), reverse=True)


@app.get("/health")
def health():
    return {"status": "UP", "modelLoaded": "model" in state,
            "modelVersion": state.get("meta", {}).get("version")}


@app.get("/model-info")
def model_info():
    meta = dict(state["meta"])
    meta.pop("baseline", None)
    return meta


def _to_row(patient: Patient) -> tuple[dict, pd.DataFrame]:
    data = patient.model_dump()
    row = pd.DataFrame([{f: (np.nan if data[f] is None else float(data[f])) for f in FEATURES}])
    return data, row


def _build_prediction(data: dict, row: pd.DataFrame, proba: float) -> Prediction:
    return Prediction(
        probability=round(proba, 4),
        modelVersion=state["meta"].get("version", "1.0"),
        factors=explain(state["model"], row, proba),
        missingFields=[f for f in FEATURES if data[f] is None],
    )


@app.post("/predict", response_model=Prediction)
def predict(patient: Patient):
    data, row = _to_row(patient)
    try:
        proba = float(state["model"].predict_proba(row)[0, 1])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Model failed: {type(e).__name__}") from e
    return _build_prediction(data, row, proba)


@app.post("/predict/batch", response_model=list[Prediction])
def predict_batch(patients: list[Patient]):
    if not patients:
        return []
    if len(patients) > 50:
        raise HTTPException(422, "Batch size must not exceed 50 patients")
    parsed = [_to_row(p) for p in patients]
    batch_df = pd.concat([row for _, row in parsed], ignore_index=True)
    try:
        probas = state["model"].predict_proba(batch_df)[:, 1]
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Model failed: {type(e).__name__}") from e
    return [_build_prediction(data, row, float(p)) for (data, row), p in zip(parsed, probas)]
