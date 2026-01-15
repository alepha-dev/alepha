/**
 * Alepha HTTP Server Benchmark
 *
 * A comprehensive benchmark script for measuring and optimizing
 * the Alepha Core Server Loop performance.
 *
 * Usage:
 *   node packages/alepha/scripts/bench-server.ts [options]
 *
 * Options:
 *   --requests=N       Total number of requests (default: 10000)
 *   --concurrency=N    Concurrent connections (default: 50)
 *   --warmup=N         Warmup requests (default: 1000)
 *   --port=N           Server port (default: 3099)
 *   --external=URL     Benchmark external server instead
 *   --json             Output results as JSON
 *   --verbose          Show detailed progress
 */

import { Alepha, run as runAlepha, t } from "alepha";
import { $command } from "alepha/command";
import { $action, $route, ServerProvider } from "alepha/server";

// =============================================================================
// Metrics Collection
// =============================================================================

interface RequestMetrics {
  latencies: number[];
  errors: number;
  statusCodes: Map<number, number>;
  bytesReceived: number;
  startTime: number;
  endTime: number;
}

interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

interface BenchmarkResult {
  endpoint: string;
  metrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalDurationMs: number;
    requestsPerSecond: number;
    bytesReceived: number;
    throughputMBps: number;
  };
  latency: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
    stdDev: number;
  };
  memory: {
    before: MemorySnapshot;
    after: MemorySnapshot;
    delta: MemorySnapshot;
  };
  statusCodes: Record<number, number>;
  gcStats?: {
    collections: number;
    pauseTimeMs: number;
  };
}

function createMetrics(): RequestMetrics {
  return {
    latencies: [],
    errors: 0,
    statusCodes: new Map(),
    bytesReceived: 0,
    startTime: 0,
    endTime: 0,
  };
}

function getMemorySnapshot(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    rss: mem.rss,
  };
}

function calculatePercentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function calculateStdDev(values: number[], avg: number): number {
  if (values.length === 0) return 0;
  const squaredDiffs = values.map((v) => (v - avg) ** 2);
  const avgSquaredDiff =
    squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquaredDiff);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)} µs`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// =============================================================================
// GC Tracking (if available)
// =============================================================================

interface GCStats {
  collections: number;
  pauseTimeMs: number;
}

function setupGCTracking(): { getStats: () => GCStats; cleanup: () => void } {
  let collections = 0;
  let pauseTimeMs = 0;

  try {
    const { PerformanceObserver } = require("node:perf_hooks");
    const obs = new PerformanceObserver(
      (list: { getEntries: () => Array<{ duration: number }> }) => {
        for (const entry of list.getEntries()) {
          collections++;
          pauseTimeMs += entry.duration;
        }
      },
    );
    obs.observe({ entryTypes: ["gc"] });

    return {
      getStats: () => ({ collections, pauseTimeMs }),
      cleanup: () => obs.disconnect(),
    };
  } catch {
    return {
      getStats: () => ({ collections: 0, pauseTimeMs: 0 }),
      cleanup: () => {},
    };
  }
}

// =============================================================================
// HTTP Client for Benchmarking
// =============================================================================

async function makeRequest(
  url: string,
): Promise<{ status: number; body: string; latencyMs: number }> {
  const start = performance.now();

  try {
    const res = await fetch(url);
    const body = await res.text();
    const latencyMs = performance.now() - start;

    return { status: res.status, body, latencyMs };
  } catch {
    const latencyMs = performance.now() - start;
    return { status: 0, body: "", latencyMs };
  }
}

// =============================================================================
// Benchmark Runner
// =============================================================================

interface BenchConfig {
  requests: number;
  concurrency: number;
  warmup: number;
  verbose: boolean;
}

async function runBenchmark(
  baseUrl: string,
  endpoint: string,
  endpointName: string,
  config: BenchConfig,
): Promise<BenchmarkResult> {
  const url = `${baseUrl}${endpoint}`;
  const metrics = createMetrics();
  const gcTracker = setupGCTracking();

  // Force GC before starting (if available)
  if (global.gc) {
    global.gc();
  }

  const memBefore = getMemorySnapshot();

  // Warmup phase
  if (config.warmup > 0) {
    if (config.verbose) {
      console.log(`\n[Warmup] Running ${config.warmup} warmup requests...`);
    }

    const warmupBatch = Math.min(config.warmup, config.concurrency);
    for (let i = 0; i < config.warmup; i += warmupBatch) {
      const batch = Math.min(warmupBatch, config.warmup - i);
      await Promise.all(Array.from({ length: batch }, () => makeRequest(url)));
    }

    if (config.verbose) {
      console.log("[Warmup] Complete.");
    }
  }

  // Reset metrics after warmup
  metrics.latencies = [];
  metrics.errors = 0;
  metrics.statusCodes.clear();
  metrics.bytesReceived = 0;

  // Main benchmark
  if (config.verbose) {
    console.log(
      `\n[Benchmark] Running ${config.requests} requests with concurrency ${config.concurrency}...`,
    );
  }

  metrics.startTime = performance.now();

  let completed = 0;
  const progressInterval = config.verbose
    ? setInterval(() => {
        const elapsed = (performance.now() - metrics.startTime) / 1000;
        const rps = completed / elapsed;
        process.stdout.write(
          `\r[Progress] ${completed}/${config.requests} (${rps.toFixed(0)} req/s)`,
        );
      }, 100)
    : null;

  // Run requests in batches
  for (let i = 0; i < config.requests; i += config.concurrency) {
    const batchSize = Math.min(config.concurrency, config.requests - i);
    const results = await Promise.all(
      Array.from({ length: batchSize }, () => makeRequest(url)),
    );

    for (const result of results) {
      metrics.latencies.push(result.latencyMs);
      metrics.bytesReceived += result.body.length;

      if (result.status === 0) {
        metrics.errors++;
      } else {
        const count = metrics.statusCodes.get(result.status) || 0;
        metrics.statusCodes.set(result.status, count + 1);
      }

      completed++;
    }
  }

  metrics.endTime = performance.now();

  if (progressInterval) {
    clearInterval(progressInterval);
    process.stdout.write("\r" + " ".repeat(60) + "\r");
  }

  // Force GC after benchmark (if available)
  if (global.gc) {
    global.gc();
  }

  const memAfter = getMemorySnapshot();
  const gcStats = gcTracker.getStats();
  gcTracker.cleanup();

  // Calculate results
  const totalDurationMs = metrics.endTime - metrics.startTime;
  const sortedLatencies = [...metrics.latencies].sort((a, b) => a - b);
  const avgLatency =
    metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length ||
    0;

  return {
    endpoint: endpointName,
    metrics: {
      totalRequests: config.requests,
      successfulRequests: config.requests - metrics.errors,
      failedRequests: metrics.errors,
      totalDurationMs,
      requestsPerSecond: (config.requests / totalDurationMs) * 1000,
      bytesReceived: metrics.bytesReceived,
      throughputMBps:
        metrics.bytesReceived / (1024 * 1024) / (totalDurationMs / 1000),
    },
    latency: {
      min: sortedLatencies[0] || 0,
      max: sortedLatencies[sortedLatencies.length - 1] || 0,
      avg: avgLatency,
      p50: calculatePercentile(sortedLatencies, 50),
      p75: calculatePercentile(sortedLatencies, 75),
      p90: calculatePercentile(sortedLatencies, 90),
      p95: calculatePercentile(sortedLatencies, 95),
      p99: calculatePercentile(sortedLatencies, 99),
      stdDev: calculateStdDev(metrics.latencies, avgLatency),
    },
    memory: {
      before: memBefore,
      after: memAfter,
      delta: {
        heapUsed: memAfter.heapUsed - memBefore.heapUsed,
        heapTotal: memAfter.heapTotal - memBefore.heapTotal,
        external: memAfter.external - memBefore.external,
        rss: memAfter.rss - memBefore.rss,
      },
    },
    statusCodes: Object.fromEntries(metrics.statusCodes),
    gcStats: gcStats.collections > 0 ? gcStats : undefined,
  };
}

// =============================================================================
// Results Display
// =============================================================================

function printResults(
  results: BenchmarkResult[],
  config: { requests: number; concurrency: number; warmup: number },
): void {
  const result = results[0];

  console.log("\n" + "=".repeat(70));
  console.log(" ALEPHA HTTP SERVER BENCHMARK RESULTS");
  console.log("=".repeat(70));

  console.log("\n[Configuration]");
  console.log(`  Requests:     ${config.requests.toLocaleString()}`);
  console.log(`  Concurrency:  ${config.concurrency}`);
  console.log(`  Warmup:       ${config.warmup.toLocaleString()}`);

  console.log("\n[Performance]");
  console.log(
    `  Total Time:   ${formatDuration(result.metrics.totalDurationMs)}`,
  );
  console.log(
    `  Requests/sec: ${result.metrics.requestsPerSecond.toFixed(2)} req/s`,
  );
  console.log(
    `  Throughput:   ${result.metrics.throughputMBps.toFixed(2)} MB/s`,
  );
  console.log(`  Data recv:    ${formatBytes(result.metrics.bytesReceived)}`);

  console.log("\n[Latency]");
  console.log(`  Min:          ${formatDuration(result.latency.min)}`);
  console.log(`  Max:          ${formatDuration(result.latency.max)}`);
  console.log(`  Avg:          ${formatDuration(result.latency.avg)}`);
  console.log(`  Std Dev:      ${formatDuration(result.latency.stdDev)}`);
  console.log(`  p50:          ${formatDuration(result.latency.p50)}`);
  console.log(`  p75:          ${formatDuration(result.latency.p75)}`);
  console.log(`  p90:          ${formatDuration(result.latency.p90)}`);
  console.log(`  p95:          ${formatDuration(result.latency.p95)}`);
  console.log(`  p99:          ${formatDuration(result.latency.p99)}`);

  console.log("\n[Requests]");
  console.log(
    `  Successful:   ${result.metrics.successfulRequests.toLocaleString()}`,
  );
  console.log(
    `  Failed:       ${result.metrics.failedRequests.toLocaleString()}`,
  );
  console.log(`  Status Codes: ${JSON.stringify(result.statusCodes)}`);

  console.log("\n[Memory]");
  console.log(`  Heap Before:  ${formatBytes(result.memory.before.heapUsed)}`);
  console.log(`  Heap After:   ${formatBytes(result.memory.after.heapUsed)}`);
  console.log(
    `  Heap Delta:   ${result.memory.delta.heapUsed >= 0 ? "+" : ""}${formatBytes(result.memory.delta.heapUsed)}`,
  );
  console.log(`  RSS Before:   ${formatBytes(result.memory.before.rss)}`);
  console.log(`  RSS After:    ${formatBytes(result.memory.after.rss)}`);

  if (result.gcStats) {
    console.log("\n[Garbage Collection]");
    console.log(`  Collections:  ${result.gcStats.collections}`);
    console.log(
      `  Pause Time:   ${formatDuration(result.gcStats.pauseTimeMs)}`,
    );
  }

  console.log("\n" + "=".repeat(70));

  // Performance summary
  const rps = result.metrics.requestsPerSecond;
  console.log("\n[Summary]");
  if (rps > 50000) {
    console.log("  Performance: EXCELLENT (>50k req/s)");
  } else if (rps > 20000) {
    console.log("  Performance: GOOD (>20k req/s)");
  } else if (rps > 10000) {
    console.log("  Performance: FAIR (>10k req/s)");
  } else {
    console.log("  Performance: NEEDS OPTIMIZATION (<10k req/s)");
  }

  // Optimization hints
  console.log("\n[Optimization Hints]");
  if (result.latency.p99 > result.latency.avg * 5) {
    console.log(
      "  - High p99 latency indicates tail latency issues (consider GC tuning)",
    );
  }
  if (result.gcStats && result.gcStats.pauseTimeMs > 100) {
    console.log(
      "  - Significant GC pause time detected (consider object pooling)",
    );
  }
  if (result.memory.delta.heapUsed > 50 * 1024 * 1024) {
    console.log(
      "  - Large heap growth during benchmark (check for memory leaks)",
    );
  }
  if (result.latency.stdDev > result.latency.avg) {
    console.log(
      "  - High latency variance (consider connection pooling or async bottlenecks)",
    );
  }

  // Summary table
  console.log("\n[All Endpoints Summary]");
  console.log("-".repeat(70));
  console.log(
    `${"Endpoint".padEnd(25)} ${"req/s".padStart(10)} ${"avg".padStart(12)} ${"p99".padStart(12)}`,
  );
  console.log("-".repeat(70));
  for (const r of results) {
    console.log(
      `${r.endpoint.padEnd(25)} ${r.metrics.requestsPerSecond.toFixed(0).padStart(10)} ${formatDuration(r.latency.avg).padStart(12)} ${formatDuration(r.latency.p99).padStart(12)}`,
    );
  }
  console.log("-".repeat(70));
}

// =============================================================================
// Alepha Server Setup
// =============================================================================

class BenchmarkAPI {
  // Simple hello world endpoint
  hello = $route({
    path: "/hello",
    handler: () => "Hello, World!",
  });

  // Ping/pong for minimal overhead testing
  ping = $route({
    path: "/ping",
    handler: () => "pong",
  });

  // JSON response endpoint
  json = $action({
    path: "/json",
    schema: {
      response: t.object({
        message: t.text(),
        timestamp: t.integer(),
      }),
    },
    handler: () => ({
      message: "Hello, World!",
      timestamp: Date.now(),
    }),
  });

  // Echo endpoint with validation
  echo = $action({
    method: "POST",
    path: "/echo",
    schema: {
      body: t.object({
        data: t.text(),
      }),
      response: t.object({
        data: t.text(),
        length: t.integer(),
      }),
    },
    handler: ({ body }) => ({
      data: body.data,
      length: body.data.length,
    }),
  });

  // Parameterized endpoint
  user = $action({
    path: "/users/:id",
    schema: {
      params: t.object({ id: t.text() }),
      response: t.object({
        id: t.text(),
        name: t.text(),
      }),
    },
    handler: ({ params }) => ({
      id: params.id,
      name: `User ${params.id}`,
    }),
  });
}

// =============================================================================
// Command Definition
// =============================================================================

class BenchServerCommand {
  bench = $command({
    root: true,
    description: "Benchmark the Alepha HTTP server",
    flags: t.object({
      requests: t.integer({
        default: 10000,
        description: "Total number of requests",
      }),
      concurrency: t.integer({
        default: 50,
        description: "Concurrent connections",
      }),
      warmup: t.integer({
        default: 1000,
        description: "Warmup requests",
      }),
      port: t.integer({
        default: 3099,
        description: "Server port",
      }),
      external: t.optional(
        t.text({
          description: "Benchmark external server URL instead",
        }),
      ),
      json: t.boolean({
        default: false,
        description: "Output results as JSON",
      }),
      verbose: t.boolean({
        default: false,
        description: "Show detailed progress",
      }),
    }),
    handler: async ({ flags }) => {
      const { requests, concurrency, warmup, port, external, json, verbose } =
        flags;

      if (!json) {
        console.log("=".repeat(70));
        console.log(" ALEPHA HTTP SERVER BENCHMARK");
        console.log("=".repeat(70));
        console.log(`\nNode.js: ${process.version}`);
        console.log(`Platform: ${process.platform} ${process.arch}`);
      }

      let baseUrl: string;
      let alepha: Alepha | null = null;

      if (external) {
        baseUrl = external;
        if (!json) {
          console.log(`Target: ${baseUrl} (external)`);
        }
      } else {
        // Start internal Alepha server
        alepha = Alepha.create({
          env: {
            NODE_ENV: "production",
            LOG_LEVEL: "error",
            SERVER_PORT: port,
            SERVER_HOST: "127.0.0.1",
          },
        });

        alepha.with(BenchmarkAPI);

        // Wait for server to start
        await new Promise<void>((resolve) => {
          runAlepha(alepha!, {
            ready: () => {
              const server = alepha!.inject(ServerProvider);
              baseUrl = server.hostname.startsWith("http")
                ? server.hostname
                : `http://${server.hostname}`;
              if (!json) {
                console.log(`Target: ${baseUrl} (internal)`);
              }
              resolve();
            },
          });
        });
      }

      // Run benchmarks for different endpoints
      const endpoints = [
        { name: "hello (plain text)", path: "/hello" },
        { name: "ping (minimal)", path: "/ping" },
        { name: "json (typed response)", path: "/api/json" },
        { name: "user/:id (params)", path: "/api/users/123" },
      ];

      const results: BenchmarkResult[] = [];
      const config: BenchConfig = { requests, concurrency, warmup, verbose };

      for (const endpoint of endpoints) {
        if (!json) {
          console.log(`\n[Testing: ${endpoint.name}]`);
        }

        const result = await runBenchmark(
          baseUrl!,
          endpoint.path,
          endpoint.name,
          config,
        );
        results.push(result);

        if (!json) {
          console.log(
            `  ${result.metrics.requestsPerSecond.toFixed(0)} req/s, ` +
              `avg: ${formatDuration(result.latency.avg)}, ` +
              `p99: ${formatDuration(result.latency.p99)}`,
          );
        }
      }

      // Print results
      if (json) {
        console.log(
          JSON.stringify(
            {
              nodeVersion: process.version,
              platform: `${process.platform} ${process.arch}`,
              results,
            },
            null,
            2,
          ),
        );
      } else {
        printResults(results, { requests, concurrency, warmup });
      }

      // Cleanup
      if (alepha) {
        await alepha.stop();
      }

      process.exit(0);
    },
  });
}

// =============================================================================
// Main
// =============================================================================

const alepha = Alepha.create();
alepha.with(BenchServerCommand);
await alepha.start();
