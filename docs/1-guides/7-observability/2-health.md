# Health Checks

Every production app needs a health endpoint. Load balancers, Kubernetes, and monitoring systems all need to know if your app is alive.

Alepha provides health endpoints out of the box.

## Basic Setup

```typescript
import { Alepha } from "alepha";
import { AlephaServerHealth } from "alepha/server/health";

const alepha = Alepha.create()
  .with(AlephaServerHealth);
```

This gives you two endpoints:

### `/health` - Detailed Health

Returns JSON with status and uptime:

```json
{
  "status": "ok",
  "uptime": 12345
}
```

Use this for monitoring dashboards and detailed checks.

### `/healthz` - Simple Probe

Returns plain text:

```
ok
```

Use this for Kubernetes liveness/readiness probes. It's lightweight and fast.

## Kubernetes Configuration

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: app
      livenessProbe:
        httpGet:
          path: /healthz
          port: 3000
        initialDelaySeconds: 5
        periodSeconds: 10
      readinessProbe:
        httpGet:
          path: /healthz
          port: 3000
        initialDelaySeconds: 5
        periodSeconds: 5
```

## Docker Healthcheck

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/healthz || exit 1
```

## Load Balancer Configuration

Most load balancers (AWS ALB, nginx, HAProxy) can use `/healthz` to check if instances are healthy:

**AWS ALB:**
```
Health check path: /healthz
Healthy threshold: 2
Unhealthy threshold: 3
Timeout: 5 seconds
Interval: 30 seconds
```

**nginx:**
```nginx
upstream backend {
  server app1:3000;
  server app2:3000;
  health_check uri=/healthz interval=10s;
}
```

## Custom Health Checks

Need to check database connectivity or external services? Extend the health check:

```typescript
import { $action } from "alepha/server";
import { $inject } from "alepha";
import { DatabaseService } from "./DatabaseService";

class CustomHealthApi {
  db = $inject(DatabaseService);

  health = $action({
    method: "GET",
    path: "/health",
    handler: async () => {
      const dbHealthy = await this.db.ping();

      return {
        status: dbHealthy ? "ok" : "degraded",
        uptime: process.uptime(),
        checks: {
          database: dbHealthy ? "ok" : "error",
        },
      };
    },
  });
}
```

## Best Practices

1. **Keep `/healthz` fast** - Don't do database queries or external calls
2. **Use `/health` for deep checks** - Include dependency status
3. **Return appropriate status codes** - 200 for healthy, 503 for unhealthy
4. **Don't expose sensitive info** - Health endpoints are often public
5. **Set reasonable timeouts** - Health checks should respond quickly
