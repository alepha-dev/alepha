# Metrics

For serious monitoring, you need metrics. Alepha integrates with Prometheus out of the box.

## Setup

```typescript
import { Alepha } from "alepha";
import { AlephaServerMetrics } from "alepha/server-metrics";

const alepha = Alepha.create()
  .with(AlephaServerMetrics);

// GET /metrics -> prometheus format
```

## What You Get

The metrics endpoint exposes:

- **HTTP request count** - Total requests by method, path, status
- **HTTP request duration** - Histogram of response times
- **Active connections** - Current open connections
- **Node.js metrics** - Memory, CPU, event loop lag

Example output:

```prometheus
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/users",status="200"} 1523
http_requests_total{method="POST",path="/api/users",status="201"} 42
http_requests_total{method="GET",path="/api/users",status="500"} 3

# HELP http_request_duration_seconds HTTP request duration in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",path="/api/users",le="0.1"} 1400
http_request_duration_seconds_bucket{method="GET",path="/api/users",le="0.5"} 1510
http_request_duration_seconds_bucket{method="GET",path="/api/users",le="1"} 1520
http_request_duration_seconds_bucket{method="GET",path="/api/users",le="+Inf"} 1523

# HELP nodejs_heap_size_total_bytes Process heap size in bytes
# TYPE nodejs_heap_size_total_bytes gauge
nodejs_heap_size_total_bytes 52428800
```

## Prometheus Configuration

Add Alepha to your Prometheus scrape config:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'alepha-app'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: /metrics
    scrape_interval: 15s
```

## Grafana Dashboard

Once Prometheus is scraping your metrics, create dashboards in Grafana:

**Request Rate:**
```promql
rate(http_requests_total[5m])
```

**Error Rate:**
```promql
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))
```

**P95 Latency:**
```promql
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

**Memory Usage:**
```promql
nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes
```

## Custom Metrics

Need application-specific metrics? Use the metrics provider directly:

```typescript
import { $inject } from "alepha";
import { MetricsProvider } from "alepha/server-metrics";

class OrderService {
  metrics = $inject(MetricsProvider);

  private orderCounter = this.metrics.counter({
    name: "orders_total",
    help: "Total number of orders",
    labelNames: ["status"],
  });

  private orderValue = this.metrics.histogram({
    name: "order_value_dollars",
    help: "Order value in dollars",
    buckets: [10, 50, 100, 500, 1000],
  });

  async createOrder(order: Order) {
    // ... create order logic ...

    this.orderCounter.inc({ status: "created" });
    this.orderValue.observe(order.total);
  }
}
```

## Alerting

Set up alerts in Prometheus or Grafana:

```yaml
# prometheus/alerts.yml
groups:
  - name: alepha
    rules:
      - alert: HighErrorRate
        expr: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }}"

      - alert: SlowResponses
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow response times"
          description: "P95 latency is {{ $value }}s"
```

## Best Practices

1. **Don't over-label** - High cardinality labels (user IDs, request IDs) will blow up your storage
2. **Use histograms for latency** - They give you percentiles without pre-aggregation
3. **Set meaningful buckets** - Match your SLOs (e.g., buckets at 100ms, 500ms, 1s)
4. **Monitor the four golden signals** - Latency, traffic, errors, saturation
5. **Scrape frequently enough** - 15s is standard, 5s for critical services
