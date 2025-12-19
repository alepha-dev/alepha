# Logging & Monitoring

`console.log` is fine for debugging. It's not fine for production.

Alepha has a structured logging system that knows where logs come from, supports log levels, and outputs pretty colors in dev or JSON in production.

## Basic Logging

Use `$logger()` in any service:

```typescript
import { $logger } from "alepha/logger";

class PaymentService {
  log = $logger();

  async processPayment(orderId: string, amount: number) {
    this.log.info("Processing payment", { orderId, amount });

    try {
      await this.stripe.charge(amount);
      this.log.info("Payment successful", { orderId });
    } catch (error) {
      this.log.error("Payment failed", { orderId, error });
      throw error;
    }
  }
}
```

Output in development (pretty):
```
[14:32:05.123] INFO <app.PaymentService> Processing payment { orderId: "ord_123", amount: 99.99 }
[14:32:05.456] INFO <app.PaymentService> Payment successful { orderId: "ord_123" }
```

Output in production (JSON, one line):
```json
{"level":"info","time":"2024-01-15T14:32:05.123Z","module":"app.PaymentService","msg":"Processing payment","orderId":"ord_123","amount":99.99}
```

JSON logs are parseable by Datadog, Grafana Loki, CloudWatch, etc.

### Log Destination

By default, logs go to **stdout** and are **synchronous**. This means every `log.info()` call blocks until the message is written.

For development, this is fine. You want logs immediately, and the performance hit is negligible.

For high-throughput production systems, synchronous logging can become a bottleneck. An async destination with buffering is planned for a future release. For now, if you're logging thousands of messages per second, consider:
- Reducing log verbosity (`LOG_LEVEL=warn`)
- Logging to a file and tailing it
- Using an external log shipper (Fluentd, Vector)

## Log Levels

Alepha supports six levels (from quietest to noisiest):

```typescript
// SILENT - nothing logged
this.log.error("Something broke");           // ERROR - red
this.log.warn("Something unexpected");       // WARN - yellow
this.log.info("Normal operations");          // INFO - default visible
this.log.debug("Detailed debugging info");   // DEBUG - hidden by default
this.log.trace("Very detailed tracing");     // TRACE - extremely verbose
```

### Configuring Log Level

Set via `LOG_LEVEL` environment variable:

```bash
LOG_LEVEL=debug npx alepha dev    # see debug and above
LOG_LEVEL=warn npx alepha start   # quiet production, only warnings+
LOG_LEVEL=trace npx alepha dev    # see absolutely everything
LOG_LEVEL=silent npx alepha start # complete silence
```

### Per-Module Log Levels

This is where Alepha shines. You can set different levels for different modules:

```bash
# global info, but debug for payments module
LOG_LEVEL="info,app.payments:debug" npx alepha dev

# multiple module configs
LOG_LEVEL="alepha.core:trace,app.users:debug,warn" npx alepha dev

# use equals or colon - both work
LOG_LEVEL="app.payments=debug,info" npx alepha dev

# semicolon separator also works
LOG_LEVEL="alepha:trace;app:debug;info" npx alepha dev
```

### Wildcard Patterns

Need to debug an entire namespace? Use wildcards:

```bash
# all alepha.* modules at debug level
LOG_LEVEL="alepha.*:debug,info" npx alepha dev

# all modules ending in .test at silent
LOG_LEVEL="*.test:silent,info" npx alepha dev
```

### How Matching Works

The logger uses **first match wins** with prefix matching:

```typescript
// config: "alepha:debug,alepha.core:trace,info"

// "alepha.core" matches "alepha" first → DEBUG (not TRACE!)
// order matters: put specific patterns first

// better: "alepha.core:trace,alepha:debug,info"
// now "alepha.core" matches first → TRACE
```

This is huge. You can turn on trace logging for just the one service causing problems without drowning in noise from the rest of the app.

## Context-Aware Logging

The logger automatically includes the module name. If you're using `$module`, logs show the full path:

```typescript
const PaymentsModule = $module({
  name: "app.payments",
  services: [PaymentService, RefundService],
});

// logs from PaymentService show: <app.payments.PaymentService>
```

This makes it trivial to filter logs in production:
```bash
grep "app.payments" /var/log/myapp.log
```

## Request Logging

Want to log every HTTP request? Alepha does it automatically when you enable the server module. You'll see:

```
[14:32:05.100] INFO <alepha.server> --> GET /api/users
[14:32:05.150] INFO <alepha.server> <-- GET /api/users 200 50ms
```

## Health Checks

Every production app needs a health endpoint. Alepha provides one out of the box:

```typescript
import { AlephaServerHealth } from "alepha/server/health";

const alepha = Alepha.create()
  .with(AlephaServerHealth);

// now you have:
// GET /health   -> { status: "ok", uptime: 12345 }
// GET /healthz  -> "ok" (for k8s probes)
```

## Prometheus Metrics

For serious monitoring, enable the metrics module:

```typescript
import { AlephaServerMetrics } from "alepha/server/metrics";

const alepha = Alepha.create()
  .with(AlephaServerMetrics);

// GET /metrics -> prometheus format
```

You get automatic metrics for:
- HTTP request count and duration
- Response status codes
- Active connections

Scrape `/metrics` with Prometheus, visualize in Grafana.

## DevTools

Alepha has built-in DevTools for development:

```typescript
import { AlephaDevtools } from "@alepha/devtools";

const alepha = Alepha.create()
  .with(AlephaDevtools);

// visit http://localhost:3000/devtools
```

DevTools shows:
- All registered actions, schedulers
- Last 10,000 log entries (filterable)
- Current atom state
- Active jobs and their status

It's like Redux DevTools but for your entire backend.

## Comparison: Winston vs Pino vs Alepha

**Winston:**
```typescript
// lots of configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

logger.info("message", { orderId: "123" });
// doesn't know which service it came from
```

**Pino:**
```typescript
// fast, but manual setup
const logger = pino({ level: 'info' });
const childLogger = logger.child({ module: 'PaymentService' });
childLogger.info({ orderId: "123" }, "message");
```

**Alepha:**
```typescript
// zero config, automatic context
class PaymentService {
  log = $logger();  // knows it's PaymentService

  doThing() {
    this.log.info("message", { orderId: "123" });
    // output includes module name automatically
  }
}
```

## Best Practices

### Log at Boundaries

```typescript
// log when entering/exiting important operations
async processOrder(order: Order) {
  this.log.info("Processing order", { orderId: order.id });

  // ... lots of internal work ...

  this.log.info("Order processed", { orderId: order.id, duration: elapsed });
}
```

### Include Context

```typescript
// bad
this.log.error("Payment failed");

// good
this.log.error("Payment failed", {
  orderId,
  amount,
  customerId,
  errorCode: error.code,
});
```

### Don't Log Secrets

```typescript
// bad - password in logs
this.log.info("User login", { email, password });

// good
this.log.info("User login", { email });
```

### Use Appropriate Levels

```typescript
this.log.trace("Entering function with args", { args });  // extreme detail
this.log.debug("Cache hit for key xyz");                  // debugging info
this.log.info("User created");                            // normal operations
this.log.warn("Rate limit approaching");                  // concerning but not broken
this.log.error("Database connection lost");               // something broke
```

## Summary

| Need | Solution |
|------|----------|
| Basic logging | `$logger()` |
| JSON logs for production | `LOG_FORMAT=json` (default in prod) |
| Debug specific module | `LOG_LEVEL="module.name:debug,info"` |
| Debug with wildcards | `LOG_LEVEL="app.*:debug,info"` |
| Health endpoint | `AlephaServerHealth` |
| Prometheus metrics | `AlephaServerMetrics` |
| Visual debugging | `AlephaDevtools` |

Logging is unglamorous but essential. Alepha makes it structured, filterable, and production-ready out of the box.
