package com.example.heart;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;

import com.example.heart.controller.PredictionController;
import com.example.heart.dto.ClinicalInsight;
import com.example.heart.dto.Factor;
import com.example.heart.dto.PredictionResponse;
import com.example.heart.exception.GlobalExceptionHandler;
import com.example.heart.exception.MlServiceUnavailableException;
import com.example.heart.service.PredictionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@WebMvcTest(PredictionController.class)
@Import(GlobalExceptionHandler.class)
class PredictionControllerTest {

    private static final String VALID = """
            {"age":63,"sex":1,"cp":4,"trestbps":145,"chol":233,"fbs":1,"restecg":2,
             "thalach":150,"exang":0,"oldpeak":2.3,"slope":3,"ca":0,"thal":6}""";
    private static final String MINIMAL = """
            {"age":63,"sex":1,"cp":4,"trestbps":145,"chol":233}""";
    private static final PredictionResponse RESPONSE = new PredictionResponse(
            0.82,
            "HIGH",
            "2.0",
            List.of(new Factor("ca", "Blocked major vessels", 2.0, 0.21)),
            List.of(),
            1.0,
            List.of(new ClinicalInsight("trestbps", "Resting blood pressure", "ALERT", "High blood pressure")),
            "x");

    @Autowired MockMvc mvc;
    @MockitoBean PredictionService service;

    private ResultActions postJson(String uri, String body) throws Exception {
        return mvc.perform(post(uri).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    @Test
    void validRequestReturnsPrediction() throws Exception {
        when(service.predict(any())).thenReturn(RESPONSE);
        postJson("/api/predict", VALID)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.probability").value(0.82))
                .andExpect(jsonPath("$.riskLevel").value("HIGH"))
                .andExpect(jsonPath("$.factors[0].feature").value("ca"))
                .andExpect(jsonPath("$.insights[0].status").value("ALERT"));
    }

    @Test
    void optionalClinicalFieldsMayBeOmitted() throws Exception {
        when(service.predict(any())).thenReturn(RESPONSE);
        postJson("/api/predict", MINIMAL).andExpect(status().isOk());
    }

    @Test
    void batchPredictionReturnsList() throws Exception {
        when(service.predictBatch(anyList())).thenReturn(List.of(RESPONSE, RESPONSE));
        postJson("/api/predict/batch", "[" + VALID + "," + MINIMAL + "]")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].riskLevel").value("HIGH"));
    }

    @Test
    void emptyBatchIsRejected() throws Exception {
        postJson("/api/predict/batch", "[]")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors").exists());
    }

    @Test
    void invalidItemInBatchIsRejected() throws Exception {
        String bad = VALID.replace("\"age\":63", "\"age\":500");
        postJson("/api/predict/batch", "[" + VALID + "," + bad + "]")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors").exists());
    }

    @Test
    void outOfRangeValueIsRejected() throws Exception {
        postJson("/api/predict", VALID.replace("\"age\":63", "\"age\":500"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.age").exists());
    }

    @Test
    void invalidCategoryCodeIsRejected() throws Exception {
        postJson("/api/predict", VALID.replace("\"thal\":6", "\"thal\":5"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.thal").exists());
    }

    @Test
    void missingRequiredFieldIsRejected() throws Exception {
        postJson("/api/predict", "{\"age\":50}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.chol").exists());
    }

    @Test
    void malformedJsonIsRejected() throws Exception {
        postJson("/api/predict", "{not json").andExpect(status().isBadRequest());
    }

    @Test
    void mlServiceDownReturns503() throws Exception {
        when(service.predict(any())).thenThrow(new MlServiceUnavailableException("down", null));
        postJson("/api/predict", VALID).andExpect(status().isServiceUnavailable());
    }

    @Test
    void modelInfoIsExposed() throws Exception {
        when(service.modelInfo()).thenReturn(Map.of("version", "2.0", "algorithm", "RandomForest"));
        mvc.perform(get("/api/model-info"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value("2.0"));
    }

    @Test
    void riskLevelThresholds() {
        org.junit.jupiter.api.Assertions.assertEquals("LOW", PredictionService.riskLevel(0.10));
        org.junit.jupiter.api.Assertions.assertEquals("MEDIUM", PredictionService.riskLevel(0.33));
        org.junit.jupiter.api.Assertions.assertEquals("HIGH", PredictionService.riskLevel(0.66));
    }
}
