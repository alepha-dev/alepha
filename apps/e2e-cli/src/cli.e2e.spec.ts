/**
 * End-to-end tests for Alepha CLI.
 *
 * These tests create a real project at apps/tmp and run actual CLI commands.
 * The test project is gitignored and regenerated on each test run.
 */
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const thisFile = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(thisFile), "../../.."); // apps/e2e-cli/src -> monorepo root
const PROJECT_DIR = join(ROOT, "apps/tmp");
const isWindows = process.platform === "win32";

/**
 * Run a command and wait for completion.
 */
async function run(
  command: string,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, [], {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "development",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(
      () => {
        proc.kill();
        reject(new Error(`Command timed out: ${command}`));
      },
      isWindows ? 90000 : 40000,
    );

    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * Start a long-running process and return a handle.
 */
function startProcess(
  command: string,
  cwd: string,
  env: Record<string, string> = {},
): {
  process: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  kill: () => Promise<void>;
  waitForOutput: (pattern: RegExp, timeout?: number) => Promise<void>;
} {
  let stdout = "";
  let stderr = "";

  const proc = spawn(command, [], {
    cwd,
    shell: true,
    detached: !isWindows,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
      ...env,
    },
  });

  proc.stdout?.on("data", (data) => {
    stdout += data.toString();
  });

  proc.stderr?.on("data", (data) => {
    stderr += data.toString();
  });

  return {
    process: proc,
    stdout: () => stdout,
    stderr: () => stderr,
    kill: async () => {
      if (isWindows) {
        spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else if (proc.pid) {
        try {
          process.kill(-proc.pid, "SIGTERM");
        } catch {
          proc.kill("SIGTERM");
        }
      }
      // Wait for cleanup (Windows needs more time to release file handles)
      await new Promise((r) => setTimeout(r, isWindows ? 3000 : 500));
    },
    waitForOutput: (pattern: RegExp, timeout = 30_000) => {
      return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const check = () => {
          if (pattern.test(stdout + stderr)) {
            resolve();
            return;
          }
          if (Date.now() - startTime > timeout) {
            reject(
              new Error(
                `Timeout waiting for pattern: ${pattern}\nStdout: ${stdout}\nStderr: ${stderr}`,
              ),
            );
            return;
          }
          setTimeout(check, 100);
        };
        check();
      });
    },
  };
}

/**
 * Fetch with retry for server startup.
 */
async function fetchWithRetry(
  url: string,
  maxRetries = 10,
  delay = 500,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetch(url);
    } catch (err) {
      lastError = err as Error;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

describe("Alepha CLI E2E", () => {
  beforeAll(async () => {
    // Clean up any existing project
    if (existsSync(PROJECT_DIR)) {
      await rm(PROJECT_DIR, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    // Skip cleanup on Windows CI - runners are ephemeral and EBUSY errors are common
    if (isWindows && process.env.CI) {
      return;
    }
    if (existsSync(PROJECT_DIR)) {
      await rm(PROJECT_DIR, { recursive: true, force: true });
    }
  });

  test("alepha init --api --react --test creates project", async () => {
    const result = await run(
      "yarn alepha init apps/tmp --api --react --test",
      ROOT,
    );

    if (result.exitCode !== 0) {
      console.log("INIT FAILED:");
      console.log("stdout:", result.stdout.slice(-2000));
      console.log("stderr:", result.stderr);
    }

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(PROJECT_DIR, "package.json"))).toBe(true);
    expect(existsSync(join(PROJECT_DIR, "src/main.server.ts"))).toBe(true);
    expect(existsSync(join(PROJECT_DIR, "src/api/index.ts"))).toBe(true);
    expect(existsSync(join(PROJECT_DIR, "src/web/index.ts"))).toBe(true);
  });

  test("alepha dev starts server and responds to requests", async () => {
    const devServer = startProcess("yarn alepha dev", PROJECT_DIR, {
      SERVER_PORT: "15000",
    });

    try {
      // Wait for server to be ready
      await devServer.waitForOutput(
        /ready in|Server listening|localhost/i,
        60_000,
      );

      // Give it a moment to stabilize
      await new Promise((r) => setTimeout(r, 1000));

      // Test that server responds
      const response = await fetchWithRetry("http://localhost:15000", 20, 500);
      expect(response.status).toBe(200);
    } finally {
      await devServer.kill();
    }
  });

  test("alepha dev handles errors and recovery", async () => {
    const mainServerPath = join(PROJECT_DIR, "src/main.server.ts");
    const originalContent = await readFile(mainServerPath, "utf-8");

    const devServer = startProcess("yarn alepha dev", PROJECT_DIR, {
      SERVER_PORT: "5001",
    });

    try {
      // Wait for server to be ready
      await devServer.waitForOutput(
        /ready in|Server listening|localhost/i,
        60_000,
      );
      await new Promise((r) => setTimeout(r, 1000));

      // Verify server is working
      const initialResponse = await fetchWithRetry("http://localhost:5001");
      expect(initialResponse.status).toBe(200);

      // Introduce a syntax error
      await writeFile(
        mainServerPath,
        `${originalContent}\n\nconst broken = {`,
        "utf-8",
      );

      // Wait for HMR to process
      await new Promise((r) => setTimeout(r, 2000));

      // Server might return 500 or connection error - both are acceptable
      const errorResponse = await fetch("http://localhost:5001");
      // If we get a response, it should be an error
      expect(errorResponse.status).toBeGreaterThanOrEqual(400);

      // Fix the error
      await writeFile(mainServerPath, originalContent, "utf-8");

      // Wait for recovery (Windows file watchers are slower)
      await new Promise((r) => setTimeout(r, isWindows ? 8000 : 3000));

      // Server should be working again
      const recoveryResponse = await fetchWithRetry(
        "http://localhost:5001",
        20,
        500,
      );
      expect(recoveryResponse.status).toBe(200);
    } finally {
      // Restore original file in case of test failure
      await writeFile(mainServerPath, originalContent, "utf-8");
      await devServer.kill();
    }
  });

  test("alepha test runs successfully", async () => {
    const result = await run("yarn alepha test", PROJECT_DIR);

    if (result.exitCode !== 0) {
      console.log("TEST OUTPUT:", result.stdout.slice(-1000));
      console.log("TEST STDERR:", result.stderr);
    }

    // Test should succeed - the generated project has a dummy test
    expect(result.exitCode).toBe(0);
  });

  test("alepha build runs successfully", async () => {
    const result = await run("yarn alepha build", PROJECT_DIR);

    if (result.exitCode !== 0) {
      console.log("BUILD OUTPUT:", result.stdout.slice(-2000));
      console.log("BUILD STDERR:", result.stderr);
    }

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(PROJECT_DIR, "dist/index.js"))).toBe(true);
  });
});
