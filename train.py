"""Heart disease prediction - training script (v2).

Usage:
    python train.py                 # uses data/processed.cleveland.data (downloads it if missing)
    python train.py --data my.csv   # use your own CSV (needs a 'target' column, 0 = healthy, 1 = disease)

What it does
    1. Loads the real UCI Cleveland dataset (303 patients). Synthetic data is only used if the
       file is missing AND the download fails, and the run is then clearly flagged as synthetic.
    2. Tunes 4 model families with GridSearchCV (5-fold stratified CV, ROC-AUC).
    3. Evaluates the winner on a 20 % stratified hold-out test set (AUC, accuracy, precision,
       recall, F1, Brier score) and computes permutation feature importance.
    4. Refits the winner on ALL data and writes:
         heart_model.joblib  - scikit-learn pipeline (pre-processing + model)
         model_meta.json     - version, metrics, feature baselines, importance (read by the API/UI)
         metrics.json        - short summary (kept for backwards compatibility)
         roc_curve.png, confusion_matrix.png
       and copies the model + metadata into ml-service/.
"""
import argparse
import json
import shutil
import warnings
from datetime import datetime, timezone
from pathlib import Path

import joblib
import matplotlib
import numpy as np
import pandas as pd
import sklearn

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (ConfusionMatrixDisplay, RocCurveDisplay, accuracy_score,
                             brier_score_loss, classification_report, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVC

warnings.filterwarnings("ignore")

MODEL_VERSION = "2.0"
ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data" / "processed.cleveland.data"
UCI_URL = ("https://archive.ics.uci.edu/ml/machine-learning-databases/"
           "heart-disease/processed.cleveland.data")

COLUMNS = ["age", "sex", "cp", "trestbps", "chol", "fbs", "restecg",
           "thalach", "exang", "oldpeak", "slope", "ca", "thal", "target"]
NUMERIC = ["age", "trestbps", "chol", "thalach", "oldpeak"]
CATEGORICAL = ["sex", "cp", "fbs", "restecg", "exang", "slope", "ca", "thal"]
FEATURES = NUMERIC + CATEGORICAL
LABELS = {
    "age": "Age", "sex": "Sex", "cp": "Chest pain type", "trestbps": "Resting blood pressure",
    "chol": "Cholesterol", "fbs": "Fasting blood sugar > 120", "restecg": "Resting ECG",
    "thalach": "Max heart rate", "exang": "Exercise-induced angina", "oldpeak": "ST depression",
    "slope": "ST slope", "ca": "Blocked major vessels", "thal": "Thalassemia test",
}


# --------------------------------------------------------------------------- data
def make_synthetic(n=1000, seed=42):
    """Synthetic data with realistic feature ranges (only if the real data is unavailable)."""
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({
        "age": rng.integers(29, 78, n), "sex": rng.integers(0, 2, n), "cp": rng.integers(1, 5, n),
        "trestbps": rng.normal(131, 17, n).round(), "chol": rng.normal(246, 51, n).round(),
        "fbs": rng.integers(0, 2, n), "restecg": rng.integers(0, 3, n),
        "thalach": rng.normal(150, 23, n).round(), "exang": rng.integers(0, 2, n),
        "oldpeak": np.clip(rng.gamma(1.2, 0.9, n), 0, 6).round(1), "slope": rng.integers(1, 4, n),
        "ca": rng.integers(0, 4, n), "thal": rng.choice([3, 6, 7], n),
    })
    logit = (0.04 * (df.age - 54) + 0.8 * df.sex + 0.6 * (df.cp == 4) - 0.03 * (df.thalach - 150)
             + 0.9 * df.exang + 0.6 * df.oldpeak + 0.7 * df.ca + 0.8 * (df.thal == 7) - 3.2)
    df["target"] = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(int)
    return df


def read_uci(source):
    df = pd.read_csv(source, header=None, names=COLUMNS, na_values="?")
    df["target"] = (df["target"] > 0).astype(int)  # 0 = no disease, 1..4 = disease
    return df


def load_data(path=None):
    """Returns (dataframe, source description, is_synthetic)."""
    if path:
        print(f"Loading {path}")
        return pd.read_csv(path), Path(path).name, False
    if DATA_FILE.exists():
        df = read_uci(DATA_FILE)
        print(f"Loaded {len(df)} real patient records from {DATA_FILE.relative_to(ROOT)}")
        return df, "UCI Cleveland Heart Disease", False
    try:
        print("Downloading UCI Cleveland heart disease dataset ...")
        df = read_uci(UCI_URL)
        DATA_FILE.parent.mkdir(exist_ok=True)
        df.to_csv(DATA_FILE, header=False, index=False, na_rep="?")
        print(f"Downloaded {len(df)} real patient records (cached in data/).")
        return df, "UCI Cleveland Heart Disease", False
    except Exception as e:  # noqa: BLE001
        print("=" * 70)
        print(f"Download failed ({type(e).__name__}). Using SYNTHETIC data - results mean nothing!")
        print("=" * 70)
        return make_synthetic(), "SYNTHETIC (demo only)", True


# --------------------------------------------------------------------------- model
def build_pipeline(model):
    pre = ColumnTransformer([
        ("num", Pipeline([("imp", SimpleImputer(strategy="median")),
                          ("sc", StandardScaler())]), NUMERIC),
        ("cat", Pipeline([("imp", SimpleImputer(strategy="most_frequent")),
                          ("oh", OneHotEncoder(handle_unknown="ignore"))]), CATEGORICAL),
    ])
    return Pipeline([("pre", pre), ("model", model)])


CANDIDATES = {
    "LogisticRegression": (LogisticRegression(max_iter=2000),
                           {"model__C": [0.01, 0.03, 0.1, 0.3, 1, 3]}),
    "RandomForest": (RandomForestClassifier(n_estimators=400, random_state=42, n_jobs=-1),
                     {"model__max_depth": [3, 5, None], "model__min_samples_leaf": [1, 3, 5],
                      "model__max_features": ["sqrt", 0.5]}),
    "GradientBoosting": (GradientBoostingClassifier(random_state=42),
                         {"model__learning_rate": [0.03, 0.1], "model__n_estimators": [100, 200],
                          "model__max_depth": [2, 3], "model__subsample": [0.8, 1.0]}),
    "SVM": (SVC(probability=True, random_state=42),
            {"model__C": [0.1, 0.3, 1, 3], "model__gamma": ["scale", 0.01, 0.03]}),
}


def baselines(X):
    """Typical (median / most frequent) value of each feature - used for per-patient explanations."""
    out = {}
    for c in FEATURES:
        s = X[c].dropna()
        out[c] = float(s.median()) if c in NUMERIC else float(s.mode().iloc[0])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", help="optional path to a CSV file")
    args = ap.parse_args()

    df, source, synthetic = load_data(args.data)
    X, y = df[FEATURES], df["target"]
    print(f"Shape: {df.shape} | disease rate: {y.mean():.1%} | missing cells: {int(X.isna().sum().sum())}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42)

    cv = StratifiedKFold(5, shuffle=True, random_state=42)
    results = {}
    for name, (model, grid) in CANDIDATES.items():
        gs = GridSearchCV(build_pipeline(model), grid, cv=cv, scoring="roc_auc", n_jobs=-1)
        gs.fit(X_train, y_train)
        std = gs.cv_results_["std_test_score"][gs.best_index_]
        results[name] = {"cv_auc": float(gs.best_score_), "cv_std": float(std),
                         "params": {k.replace("model__", ""): v for k, v in gs.best_params_.items()},
                         "estimator": gs.best_estimator_}
        print(f"{name:20s} CV ROC-AUC: {gs.best_score_:.3f} (+/- {std:.3f})  {results[name]['params']}")

    best_name = max(results, key=lambda n: results[n]["cv_auc"])
    best = results[best_name]["estimator"]
    print(f"\nBest model: {best_name}")

    proba = best.predict_proba(X_test)[:, 1]
    pred = (proba >= 0.5).astype(int)
    test = {
        "auc": roc_auc_score(y_test, proba), "accuracy": accuracy_score(y_test, pred),
        "precision": precision_score(y_test, pred), "recall": recall_score(y_test, pred),
        "f1": f1_score(y_test, pred), "brier": brier_score_loss(y_test, proba),
    }
    test = {k: round(float(v), 4) for k, v in test.items()}
    print("Test metrics:", test, "\n")
    print(classification_report(y_test, pred, target_names=["healthy", "disease"]))

    ConfusionMatrixDisplay.from_predictions(y_test, pred, display_labels=["healthy", "disease"])
    plt.title("Confusion matrix (test set)")
    plt.savefig(ROOT / "confusion_matrix.png", dpi=120, bbox_inches="tight"); plt.close()
    RocCurveDisplay.from_predictions(y_test, proba, name=best_name)
    plt.plot([0, 1], [0, 1], "k--", lw=1)
    plt.title("ROC curve (test set)")
    plt.savefig(ROOT / "roc_curve.png", dpi=120, bbox_inches="tight"); plt.close()

    imp = permutation_importance(best, X_test, y_test, scoring="roc_auc", n_repeats=30,
                                 random_state=42, n_jobs=-1)
    importance = sorted(({"feature": f, "label": LABELS[f], "importance": round(float(m), 4)}
                         for f, m in zip(FEATURES, imp.importances_mean)),
                        key=lambda d: d["importance"], reverse=True)

    # Final model: same hyper-parameters, refit on all rows (test metrics above stay honest).
    final = build_pipeline(CANDIDATES[best_name][0]).set_params(
        **{f"model__{k}": v for k, v in results[best_name]["params"].items()}).fit(X, y)
    if "n_jobs" in final.named_steps["model"].get_params():
        final.named_steps["model"].set_params(n_jobs=1)  # single-row API calls: threads only add latency

    meta = {
        "version": MODEL_VERSION,
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "algorithm": best_name,
        "hyperparameters": results[best_name]["params"],
        "dataset": {"source": source, "rows": int(len(df)), "synthetic": synthetic,
                    "diseaseRate": round(float(y.mean()), 4)},
        "cv": {n: {"auc": round(r["cv_auc"], 4), "std": round(r["cv_std"], 4)} for n, r in results.items()},
        "test": test,
        "baseline": baselines(X),
        "featureImportance": importance,
        "sklearnVersion": sklearn.__version__,
    }

    joblib.dump(final, ROOT / "heart_model.joblib")
    (ROOT / "model_meta.json").write_text(json.dumps(meta, indent=2))
    (ROOT / "metrics.json").write_text(json.dumps(
        {"best_model": best_name, "cv_auc": {n: r["cv_auc"] for n, r in results.items()},
         "test_auc": test["auc"], "n_rows": len(df), "synthetic": synthetic}, indent=2))

    svc = ROOT / "ml-service"
    if svc.is_dir():
        shutil.copy(ROOT / "heart_model.joblib", svc / "heart_model.joblib")
        shutil.copy(ROOT / "model_meta.json", svc / "model_meta.json")
    print("Saved: heart_model.joblib, model_meta.json, metrics.json, confusion_matrix.png, roc_curve.png"
          + (" (+ copied to ml-service/)" if svc.is_dir() else ""))


if __name__ == "__main__":
    main()
