package com.example.heart.dto;

/**
 * How much one input moved the prediction.
 *
 * @param impact change in probability compared with a typical patient value
 *               (positive = raises the estimated risk, negative = lowers it)
 */
public record Factor(String feature, String label, Double value, double impact) {
}
