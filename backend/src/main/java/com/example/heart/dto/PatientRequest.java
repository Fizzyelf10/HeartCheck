package com.example.heart.dto;

import com.example.heart.validation.OneOf;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

/**
 * Patient features, using the UCI Cleveland dataset column names.
 * <p>
 * The first five values are required (anyone can know them). The clinical test results are
 * optional: if a value is {@code null} the trained pipeline imputes a typical value, and the
 * response reports which fields were missing so the UI can show reduced confidence.
 */
public record PatientRequest(
        @NotNull @DecimalMin("1") @DecimalMax("120") Double age,
        @NotNull @OneOf({0, 1}) Integer sex,                     // 1 = male, 0 = female
        @NotNull @OneOf({1, 2, 3, 4}) Integer cp,                // chest pain type 1-4
        @NotNull @DecimalMin("50") @DecimalMax("300") Double trestbps, // resting blood pressure (mm Hg)
        @NotNull @DecimalMin("50") @DecimalMax("700") Double chol,     // cholesterol (mg/dl)
        @OneOf({0, 1}) Integer fbs,                              // fasting blood sugar > 120 mg/dl
        @OneOf({0, 1, 2}) Integer restecg,                       // resting ECG result 0-2
        @DecimalMin("30") @DecimalMax("250") Double thalach,     // max heart rate achieved
        @OneOf({0, 1}) Integer exang,                            // exercise-induced angina
        @DecimalMin("0") @DecimalMax("10") Double oldpeak,       // ST depression
        @OneOf({1, 2, 3}) Integer slope,                         // slope of peak ST segment 1-3
        @OneOf({0, 1, 2, 3}) Integer ca,                         // major vessels 0-3
        @OneOf({3, 6, 7}) Integer thal                           // 3 normal, 6 fixed defect, 7 reversible defect
) {
    public static final int FIELD_COUNT = 13;
}
