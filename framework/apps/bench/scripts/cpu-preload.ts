import { renameSync, writeFileSync } from "node:fs";

/**
 * Loaded before a benchmarked server (`node --import`, `bun --preload`):
 * every 50 ms it writes the process's CPU time, user plus system in µs, to
 * `CPU_OUT`. Through a temporary file and a rename, so a reader never sees
 * half a number.
 *
 * A file rather than a signal: an Alepha server exits on SIGUSR2.
 */
const out = process.env.CPU_OUT;
if (out) {
  setInterval(() => {
    const usage = process.cpuUsage();
    writeFileSync(`${out}.tmp`, String(usage.user + usage.system));
    renameSync(`${out}.tmp`, out);
  }, 50).unref();
}
