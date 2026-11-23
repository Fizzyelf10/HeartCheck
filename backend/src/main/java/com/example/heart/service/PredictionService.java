package com.example.heart.service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;

import com.example.heart.dto.ClinicalInsight;
import com.example.heart.dto.MlServiceResponse;
import com.example.heart.dto.PatientRequest;
import com.example.heart.dto.PredictionResponse;
import com.example.heart.exception.MlServiceUnavailableException;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Service
public class PredictionService {

    private static final Logger log = LoggerFactory.getLogger(PredictionService.class);
    private static final String DISCLAIMER =
            "Educational project. Not a medical device and not a diagnosis.";
    private static final Duration MODEL_INFO_TTL = Duration.ofMinutes(5);
    private static final ParameterizedTypeReference<Map<String, Object>> JSON_MAP =
            new ParameterizedTypeReference<>() { };
    private static final ParameterizedTypeReference<List<MlServiceResponse>> ML_BATCH_LIST =
            new ParameterizedTypeReference<>() { };

    private final RestClient mlRestClient;
    private final MeterRegistry meterRegistry;
    private final AtomicReference<CachedInfo> modelInfoCache = new AtomicReference<>();

    private record CachedInfo(Map<String, Object> data, Instant expiresAt) {
        boolean isFresh() {
            return Instant.now().isBefore(expiresAt);
        }
    }

    public PredictionService(RestClient mlRestClient) {
        this(mlRestClient, null);
    }

    @Autowired
    public PredictionService(RestClient mlRestClient, ObjectProvider<MeterRegistry> meterRegistryProvider) {
        this.mlRestClient = mlRestClient;
        this.meterRegistry = meterRegistryProvider != null ? meterRegistryProvider.getIfAvailable() : null;
    }

    public PredictionResponse predict(PatientRequest request) {
        long start = System.nanoTime();
        MlServiceResponse ml = callWithRetry("predict", () -> mlRestClient.post()
                .uri("/predict")
                .body(request)
                .retrieve()
                .body(MlServiceResponse.class));
        if (ml == null) {
            throw new MlServiceUnavailableException("ML service returned an empty response", null);
        }
        recordLatency(start);
        return toResponse(request, ml);
    }

    public List<PredictionResponse> predictBatch(List<PatientRequest> requests) {
        long start = System.nanoTime();
        List<MlServiceResponse> results = callWithRetry("predict/batch", () -> mlRestClient.post()
                .uri("/predict/batch")
                .body(requests)
                .retrieve()
                .body(ML_BATCH_LIST));
        if (results == null || results.size() != requests.size()) {
            throw new MlServiceUnavailableException("ML service returned an incomplete batch response", null);
        }
        recordLatency(start);
        List<PredictionResponse> responses = new ArrayList<>(requests.size());
        for (int i = 0; i < requests.size(); i++) {
            responses.add(toResponse(requests.get(i), results.get(i)));
        }
        return responses;
    }

    public Map<String, Object> modelInfo() {
        CachedInfo cached = modelInfoCache.get();
        if (cached != null && cached.isFresh()) {
            return cached.data();
        }
        Map<String, Object> info = callWithRetry("model-info", () -> mlRestClient.get()
                .uri("/model-info")
                .retrieve()
                .body(JSON_MAP));
        if (info == null) {
            throw new MlServiceUnavailableException("ML service returned no model info", null);
        }
        modelInfoCache.set(new CachedInfo(info, Instant.now().plus(MODEL_INFO_TTL)));
        return info;
    }

    private PredictionResponse toResponse(PatientRequest request, MlServiceResponse ml) {
        List<String> missing = Optional.ofNullable(ml.missingFields()).orElse(List.of());
        double completeness = (PatientRequest.FIELD_COUNT - missing.size()) / (double) PatientRequest.FIELD_COUNT;
        String risk = riskLevel(ml.probability());
        if (meterRegistry != null) {
            meterRegistry.counter("heartcheck.predictions", "risk", risk).increment();
        }
        return new PredictionResponse(
                ml.probability(),
                risk,
                ml.modelVersion(),
                Optional.ofNullable(ml.factors()).orElse(List.of()),
                missing,
                Math.round(completeness * 100) / 100.0,
                analyzeVitals(request),
                DISCLAIMER);
    }

    private <T> T callWithRetry(String operation, Supplier<T> call) {
        try {
            return call.get();
        } catch (HttpClientErrorException e) {
            // 4xx indicates a request mismatch rather than a transient outage; do not retry.
            log.warn("ML service rejected {} with {}: {}", operation, e.getStatusCode(), e.getMessage());
            throw new MlServiceUnavailableException("ML service rejected request: " + e.getStatusCode(), e);
        } catch (RestClientException first) {
            log.warn("ML service {} failed ({}), retrying once...", operation, first.getMessage());
            try {
                Thread.sleep(100);
                return call.get();
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new MlServiceUnavailableException("ML service call interrupted", ie);
            } catch (RestClientException retryEx) {
                log.warn("ML service {} retry failed: {}", operation, retryEx.getMessage());
                throw new MlServiceUnavailableException("ML service call failed: " + retryEx.getMessage(), retryEx);
            }
        }
    }

    private void recordLatency(long startNanos) {
        if (meterRegistry != null) {
            meterRegistry.timer("heartcheck.ml.latency").record(Duration.ofNanos(System.nanoTime() - startNanos));
        }
    }

    public static List<ClinicalInsight> analyzeVitals(PatientRequest req) {
        List<ClinicalInsight> insights = new ArrayList<>();

        double bp = req.trestbps();
        if (bp < 120) {
            insights.add(new ClinicalInsight("trestbps", "Resting blood pressure", "GOOD",
                    "Normal resting blood pressure (< 120 mm Hg)."));
        } else if (bp < 130) {
            insights.add(new ClinicalInsight("trestbps", "Resting blood pressure", "WARN",
                    "Elevated blood pressure (120–129 mm Hg)."));
        } else {
            insights.add(new ClinicalInsight("trestbps", "Resting blood pressure", "ALERT",
                    "High blood pressure (≥ 130 mm Hg)."));
        }

        double chol = req.chol();
        if (chol < 200) {
            insights.add(new ClinicalInsight("chol", "Total cholesterol", "GOOD",
                    "Desirable cholesterol level (< 200 mg/dL)."));
        } else if (chol < 240) {
            insights.add(new ClinicalInsight("chol", "Total cholesterol", "WARN",
                    "Borderline high cholesterol (200–239 mg/dL)."));
        } else {
            insights.add(new ClinicalInsight("chol", "Total cholesterol", "ALERT",
                    "High cholesterol (≥ 240 mg/dL)."));
        }

        if (req.fbs() != null) {
            if (req.fbs() == 1) {
                insights.add(new ClinicalInsight("fbs", "Fasting blood sugar", "WARN",
                        "Fasting blood sugar is above 120 mg/dL."));
            } else {
                insights.add(new ClinicalInsight("fbs", "Fasting blood sugar", "GOOD",
                        "Fasting blood sugar is within the normal range (≤ 120 mg/dL)."));
            }
        }

        if (req.thalach() != null) {
            double predictedMax = Math.max(100, 220 - req.age());
            double pct = Math.round((req.thalach() / predictedMax) * 100);
            if (req.thalach() >= predictedMax * 0.85) {
                insights.add(new ClinicalInsight("thalach", "Max heart rate", "GOOD",
                        "Reached " + (int) pct + "% of age-predicted max heart rate."));
            } else {
                insights.add(new ClinicalInsight("thalach", "Max heart rate", "WARN",
                        "Below 85% of age-predicted max heart rate (" + (int) pct + "%)."));
            }
        }

        return insights;
    }

    public static String riskLevel(double p) {
        if (p < 0.33) return "LOW";
        if (p < 0.66) return "MEDIUM";
        return "HIGH";
    }
}
