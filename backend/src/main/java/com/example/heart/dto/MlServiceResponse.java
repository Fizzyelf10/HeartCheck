package com.example.heart.dto;

import java.util.List;

/** Raw response from the Python ML service. */
public record MlServiceResponse(
        double probability,
        String modelVersion,
        List<Factor> factors,
        List<String> missingFields
) {
}
