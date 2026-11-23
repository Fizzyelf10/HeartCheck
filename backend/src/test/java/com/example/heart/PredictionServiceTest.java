package com.example.heart;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withBadRequest;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.List;

import com.example.heart.dto.PatientRequest;
import com.example.heart.dto.PredictionResponse;
import com.example.heart.exception.MlServiceUnavailableException;
import com.example.heart.service.PredictionService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class PredictionServiceTest {

    private static final PatientRequest SAMPLE = new PatientRequest(
            63.0, 1, 4, 145.0, 233.0, 1, 2, 150.0, 0, 2.3, 3, 0, 6);

    private MockRestServiceServer server;
    private SimpleMeterRegistry meterRegistry;
    private PredictionService service;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ml-service");
        server = MockRestServiceServer.bindTo(builder).build();
        meterRegistry = new SimpleMeterRegistry();
        ObjectProvider<io.micrometer.core.instrument.MeterRegistry> provider =
                new ObjectProvider<>() {
                    @Override public io.micrometer.core.instrument.MeterRegistry getObject() { return meterRegistry; }
                    @Override public io.micrometer.core.instrument.MeterRegistry getIfAvailable() { return meterRegistry; }
                    @Override public io.micrometer.core.instrument.MeterRegistry getIfUnique() { return meterRegistry; }
                };
        service = new PredictionService(builder.build(), provider);
    }

    @Test
    void predictRetriesOnceOnTransient5xxAndRecordsMetrics() {
        server.expect(requestTo("http://ml-service/predict"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withServerError());
        server.expect(requestTo("http://ml-service/predict"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("""
                        {"probability":0.75,"modelVersion":"2.0","factors":[],"missingFields":[]}""",
                        MediaType.APPLICATION_JSON));

        PredictionResponse res = service.predict(SAMPLE);
        assertEquals("HIGH", res.riskLevel());
        assertEquals(1.0, res.completeness());
        assertEquals(1.0, meterRegistry.counter("heartcheck.predictions", "risk", "HIGH").count());
        server.verify();
    }

    @Test
    void predictDoesNotRetryOn4xx() {
        server.expect(requestTo("http://ml-service/predict"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withBadRequest());

        assertThrows(MlServiceUnavailableException.class, () -> service.predict(SAMPLE));
        server.verify();
    }

    @Test
    void predictBatchMapsResponsesAndInsights() {
        server.expect(requestTo("http://ml-service/predict/batch"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("""
                        [
                          {"probability":0.2,"modelVersion":"2.0","factors":[],"missingFields":["thal"]},
                          {"probability":0.8,"modelVersion":"2.0","factors":[],"missingFields":[]}
                        ]""", MediaType.APPLICATION_JSON));

        List<PredictionResponse> list = service.predictBatch(List.of(SAMPLE, SAMPLE));
        assertEquals(2, list.size());
        assertEquals("LOW", list.get(0).riskLevel());
        assertEquals(0.92, list.get(0).completeness());
        assertEquals("HIGH", list.get(1).riskLevel());
        server.verify();
    }

    @Test
    void modelInfoCachesWithinTtl() {
        server.expect(requestTo("http://ml-service/model-info"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("""
                        {"version":"2.0","algorithm":"RandomForest"}""", MediaType.APPLICATION_JSON));

        var first = service.modelInfo();
        var second = service.modelInfo();
        assertEquals("2.0", first.get("version"));
        assertEquals(first, second);
        server.verify();
    }

    @Test
    void analyzeVitalsClassifiesStandardRanges() {
        var healthy = new PatientRequest(40.0, 0, 2, 115.0, 180.0, 0, 0, 170.0, 0, 0.0, 1, 0, 3);
        var insights = PredictionService.analyzeVitals(healthy);
        assertEquals(4, insights.size());
        assertEquals("GOOD", insights.get(0).status()); // trestbps < 120
        assertEquals("GOOD", insights.get(1).status()); // chol < 200
        assertEquals("GOOD", insights.get(2).status()); // fbs == 0
        assertEquals("GOOD", insights.get(3).status()); // thalach >= 85% of (220 - 40)
    }
}
