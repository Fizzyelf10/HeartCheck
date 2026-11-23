"""Predict heart disease risk for one patient using the trained model.

Usage: python predict.py          (runs an example patient)
Edit the dict below or import predict_patient() in your own code.
"""
import joblib
import pandas as pd


def predict_patient(patient: dict, model_path="heart_model.joblib"):
    model = joblib.load(model_path)
    proba = model.predict_proba(pd.DataFrame([patient]))[0, 1]
    return proba


if __name__ == "__main__":
    patient = {
        "age": 63,        # years
        "sex": 1,         # 1 = male, 0 = female
        "cp": 4,          # chest pain type 1-4 (4 = asymptomatic)
        "trestbps": 145,  # resting blood pressure (mm Hg)
        "chol": 233,      # cholesterol (mg/dl)
        "fbs": 1,         # fasting blood sugar > 120 mg/dl
        "restecg": 2,     # resting ECG result 0-2
        "thalach": 150,   # max heart rate achieved
        "exang": 0,       # exercise-induced angina
        "oldpeak": 2.3,   # ST depression
        "slope": 3,       # slope of peak ST segment 1-3
        "ca": 0,          # major vessels colored by fluoroscopy 0-3
        "thal": 6,        # 3 = normal, 6 = fixed defect, 7 = reversible defect
    }
    p = predict_patient(patient)
    print(f"Estimated probability of heart disease: {p:.1%}")
    print("Prediction:", "HIGH RISK" if p >= 0.5 else "LOW RISK")
    print("\nThis is a student project, not a medical device.")
