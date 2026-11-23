package com.example.heart.config;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** Adds the Python ML service to GET /actuator/health (component "mlService"). */
@Component("mlService")
public class MlServiceHealthIndicator implements HealthIndicator {

    private final RestClient mlRestClient;

    public MlServiceHealthIndicator(RestClient mlRestClient) {
        this.mlRestClient = mlRestClient;
    }

    @Override
    public Health health() {
        try {
            var body = mlRestClient.get().uri("/health").retrieve().body(java.util.Map.class);
            return Health.up().withDetails(body == null ? java.util.Map.of() : body).build();
        } catch (Exception e) {
            return Health.down().withDetail("error", e.getClass().getSimpleName()).build();
        }
    }
}
