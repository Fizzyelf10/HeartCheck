package com.example.heart.dto;

import java.util.List;

/**
 * @param completeness share of the 13 inputs that were provided (1.0 = all values known)
 * @param insights     clinical reference range notes for key vitals and lab values
 */
public record PredictionResponse(
        double probability,
        String riskLevel,
        String modelVersion,
        List<Factor> factors,
        List<String> missingFields,
        double completeness,
        List<ClinicalInsight> insights,
        String disclaimer
) {
}
