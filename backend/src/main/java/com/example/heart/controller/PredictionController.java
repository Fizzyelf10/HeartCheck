package com.example.heart.controller;

import java.util.List;
import java.util.Map;

import com.example.heart.dto.PatientRequest;
import com.example.heart.dto.PredictionResponse;
import com.example.heart.service.PredictionService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@Validated
public class PredictionController {

    private final PredictionService predictionService;

    public PredictionController(PredictionService predictionService) {
        this.predictionService = predictionService;
    }

    @PostMapping("/predict")
    public PredictionResponse predict(@Valid @RequestBody PatientRequest request) {
        return predictionService.predict(request);
    }

    /** Batch prediction for up to 50 patients in a single call. */
    @PostMapping("/predict/batch")
    public List<PredictionResponse> predictBatch(
            @RequestBody @Size(min = 1, max = 50, message = "batch must contain between 1 and 50 patients")
            List<@Valid PatientRequest> requests) {
        return predictionService.predictBatch(requests);
    }

    /** Model version, algorithm, test metrics and global feature importance (shown on the website). */
    @GetMapping("/model-info")
    public Map<String, Object> modelInfo() {
        return predictionService.modelInfo();
    }
}
