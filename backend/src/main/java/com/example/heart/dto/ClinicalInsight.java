package com.example.heart.dto;

/**
 * Rule-based clinical reference note for a single vital sign or lab value.
 *
 * @param field   request field name (e.g. "trestbps", "chol", "fbs", "thalach")
 * @param label   human-readable name
 * @param status  "GOOD", "WARN", or "ALERT"
 * @param message plain-language interpretation against standard reference ranges
 */
public record ClinicalInsight(String field, String label, String status, String message) {
}
