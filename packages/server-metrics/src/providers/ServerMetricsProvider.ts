import * as os from "node:os";
import { PerformanceObserver } from "node:perf_hooks";
import { $action, type ActionDescriptor } from "@alepha/server";
import { Gauge, Histogram, Registry } from "prom-client";

export class ServerMetricsProvider {
	private readonly register: Registry;
	private cpuUsage: Gauge;
	private memoryUsage: Gauge;
	private gcDuration: Histogram;
	private heapUsage: Gauge;

	public readonly metrics: ActionDescriptor = $action({
		method: "GET",
		path: "/metrics",
		silent: true,
		internal: true,
		security: false,
		handler: () => this.register.metrics(),
	});

	constructor() {
		this.register = new Registry();

		// CPU Usage Metric
		this.cpuUsage = new Gauge({
			name: "nodejs_cpu_usage_percent",
			help: "CPU usage percentage",
			registers: [this.register],
		});

		// Memory Usage Metric
		this.memoryUsage = new Gauge({
			name: "nodejs_memory_usage_bytes",
			help: "Memory usage in bytes",
			registers: [this.register],
		});

		// GC Duration Metric
		this.gcDuration = new Histogram({
			name: "nodejs_gc_duration_seconds",
			help: "Garbage collection duration in seconds",
			buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5], // Buckets for duration distribution
			registers: [this.register],
		});

		// Heap Usage Metric
		this.heapUsage = new Gauge({
			name: "nodejs_heap_usage_bytes",
			help: "Heap usage in bytes",
			registers: [this.register],
		});

		this.collectMetrics();
	}

	private collectMetrics(): void {
		// Collect CPU usage
		const cpus = os.cpus();
		const cpuUsagePercent =
			cpus.reduce(
				(acc, cpu) => acc + Object.values(cpu.times).reduce((a, b) => a + b, 0),
				0,
			) / cpus.length;
		this.cpuUsage.set(cpuUsagePercent);

		// Collect Memory usage
		const memoryUsage = process.memoryUsage().rss;
		this.memoryUsage.set(memoryUsage);

		// Collect Heap usage
		const heapUsage = process.memoryUsage().heapUsed;
		this.heapUsage.set(heapUsage);

		// Observer to collect GC metrics
		const obs = new PerformanceObserver((items) => {
			const entry = items.getEntries()[0];
			this.gcDuration.observe(entry.duration / 1000); // Convert ms to seconds
		});

		obs.observe({ entryTypes: ["gc"] });
	}
}
