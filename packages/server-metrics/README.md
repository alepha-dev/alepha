# Alepha Server Metrics

Exposes application metrics in Prometheus format at /metrics.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

This module provides prometheus metrics for the Alepha server.
Metrics are exposed at the `/metrics` endpoint.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServerMetrics } from "alepha/server/metrics";

const alepha = Alepha.create()
	.with(AlephaServerMetrics);

run(alepha);
```
