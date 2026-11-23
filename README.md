# Heart Disease Prediction (Machine Learning Project)

Predicts the probability that a patient has heart disease from 13 clinical features
(age, sex, chest pain type, blood pressure, cholesterol, max heart rate, ...).

## Files
| File | Purpose |
|---|---|
| `train.py` | Loads data, compares 3 models with 5-fold cross-validation, evaluates the best on a held-out test set, saves the model + plots |
| `predict.py` | Loads the saved model and predicts risk for one patient |
| `requirements.txt` | Python dependencies |

## Run it
```bash
pip install -r requirements.txt
python train.py      # trains, prints metrics, saves heart_model.joblib, roc_curve.png, confusion_matrix.png
python predict.py    # example prediction
```

Use your own data: `python train.py --data my.csv` (columns: age, sex, cp, trestbps, chol, fbs,
restecg, thalach, exang, oldpeak, slope, ca, thal, target with 0 = healthy, 1 = disease).

## Data
By default `train.py` downloads the **UCI Cleveland Heart Disease dataset** (303 patients).
If there is no internet it falls back to **synthetic** data so the code still runs, but results
on synthetic data mean nothing. For your report, make sure the real dataset was downloaded
(the console prints "Downloaded 303 real patient records").
Alternative: the Kaggle "Heart Disease UCI" CSV, passed in with `--data`.

## Method
1. Preprocessing pipeline: median imputation + scaling for numeric features, most-frequent imputation + one-hot encoding for categorical features (no data leakage, because it is fitted inside the pipeline).
2. Models compared: Logistic Regression, Random Forest, Gradient Boosting.
3. Selection by 5-fold cross-validated ROC-AUC on the training split; final score on a 20% stratified test set.
4. Metrics: ROC-AUC, precision, recall, F1, confusion matrix.

## Ideas to extend the project
- Hyperparameter tuning with `GridSearchCV`
- Feature importance / SHAP explanations
- A web app with Streamlit or Flask on top of `predict_patient()`
- Compare with XGBoost or a small neural network

## Disclaimer
Educational project only. Not a medical device and not for real diagnosis.

---

# Spring Boot integration

```
Client --> Spring Boot (8080)  --HTTP/JSON-->  FastAPI ML service (8000)  -->  heart_model.joblib
           validation, risk level,              loads the scikit-learn
           error handling                       pipeline once at startup
```

The model stays in Python (where it was trained); the Java backend calls it over HTTP.
This avoids exporting the model to another format and lets you retrain without touching Java.

## Run locally (two terminals)
```bash
# 1) ML service (needs heart_model.joblib in ml-service/, created by `python train.py`)
cd ml-service && pip install -r requirements.txt
cp ../heart_model.joblib .
uvicorn app:app --port 8000

# 2) Spring Boot backend (Java 17+, Maven)
cd backend && mvn spring-boot:run
```

## Or with Docker
```bash
docker compose up --build
```

## Try it
```bash
curl -X POST localhost:8080/api/predict -H 'Content-Type: application/json' -d '{
  "age":63,"sex":1,"cp":4,"trestbps":145,"chol":233,"fbs":1,"restecg":2,
  "thalach":150,"exang":0,"oldpeak":2.3,"slope":3,"ca":0,"thal":6}'
```
Response:
```json
{"probability":0.45,"riskLevel":"MEDIUM","modelVersion":"1.0","disclaimer":"..."}
```

| Case | Result |
|---|---|
| Valid patient | 200 with probability + riskLevel (LOW < 0.33, MEDIUM < 0.66, HIGH) |
| Missing or out-of-range field | 400 with per-field `errors` |
| ML service down or slow | 503 |

Health check: `GET localhost:8080/actuator/health`. Config: `ML_SERVICE_URL` env var.
Tests: `cd backend && mvn test` (controller tests with a mocked service).

---

# Website (frontend)

The website lives in `backend/src/main/resources/static/` (`index.html`, `style.css`, `app.js`).
Spring Boot serves it automatically, so there is nothing extra to build or run: start the
two services and open **http://localhost:8080**.

Features: guided 13-field form with validation, two example patients, animated risk gauge,
colour-coded LOW / MEDIUM / HIGH result, server errors shown next to the right field,
last 5 checks stored in the browser only (localStorage), responsive layout, dark mode.

Frontend validation ranges are defined in `app.js` (`GROUPS`) and must match `PatientRequest.java`.
