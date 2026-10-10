import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DesktopSupervisor } from "../../core/DesktopSupervisor.ts";

const bootstrap = new URL("./fixtures/bootstrap.ts", import.meta.url).href;
const capability = "ab".repeat(32);

describe("DesktopWorkerHost in a real Bun Worker", () => {
  const dirs: string[] = [];
  const supervisors: DesktopSupervisor[] = [];

  const setup = (
    mode: string,
    deadlines?: { readyTimeoutMs?: number; stopTimeoutMs?: number },
    extra: { dir?: string; env?: Record<string, string> } = {},
  ) => {
    const dir = extra.dir ?? mkdtempSync(join(tmpdir(), "alepha-desktop-"));
    if (!extra.dir) dirs.push(dir);
    const marker = join(dir, "stopped");
    const supervisor = new DesktopSupervisor(new Worker(bootstrap), deadlines);
    supervisors.push(supervisor);
    const start = () =>
      supervisor.start({
        name: "Fixture",
        identifier: "dev.alepha.fixture",
        capability,
        defaults: { APP_SECRET_FILE: join(dir, "secret") },
        paths: { data: dir, logs: dir, resources: dir },
        env: {
          NODE_ENV: "production",
          LOG_LEVEL: "silent",
          SERVER_HOST: "127.0.0.1",
          SERVER_PORT: "0",
          FIXTURE_MODE: mode,
          FIXTURE_MARKER: marker,
          ...extra.env,
        },
      });
    return { supervisor, marker, start };
  };

  afterEach(async () => {
    for (const supervisor of supervisors.splice(0)) {
      await supervisor.stop();
    }
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts after the entry wrapper, reports the bound loopback origin and stops through the stop hooks", async () => {
    const { supervisor, marker, start } = setup("normal");

    const started = await start();
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await fetch(`${started.origin}/hello`);
    expect(await response.text()).toBe("hello from the worker");

    const stopped = await supervisor.stop();
    expect(stopped).toEqual({ graceful: true });
    expect(readFileSync(marker, "utf8")).toBe("stopped");
    const closed = await fetch(`${started.origin}/hello`).then(
      () => false,
      () => true,
    );
    expect(closed).toBe(true);
  });

  it("generates the secret owner-only in the data folder and keeps it across launches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alepha-desktop-"));
    dirs.push(dir);
    const hashes: string[] = [];
    for (let launch = 0; launch < 2; launch++) {
      const { supervisor, start } = setup("normal", undefined, { dir });
      const started = await start();
      if (!started.ok) throw new Error(started.message);
      hashes.push(await (await fetch(`${started.origin}/secret`)).text());
      expect((await supervisor.stop()).graceful).toBe(true);
    }
    expect(statSync(join(dir, "secret")).mode & 0o777).toBe(0o600);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes[1]).toBe(hashes[0]);
  });

  it("lets an explicit APP_SECRET win over the desktop secret file", async () => {
    const { supervisor, start } = setup("normal", undefined, {
      env: { APP_SECRET: "x".repeat(40) },
    });
    const started = await start();
    if (!started.ok) throw new Error(started.message);
    const hash = await (await fetch(`${started.origin}/secret`)).text();
    expect(hash).toBe(
      new Bun.CryptoHasher("sha256").update("x".repeat(40)).digest("hex"),
    );
    await supervisor.stop();
  });

  it("reports a startup failure by its message alone and does not leave the app running", async () => {
    const { start } = setup("boot-fail");

    const started = await start();
    expect(started).toEqual({ ok: false, message: "injected startup failure" });
  });

  it("refuses an app whose own configuration asks for a fixed port or a public host", async () => {
    for (const mode of ["fixed-port", "public-host"]) {
      const started = await setup(mode).start();
      expect(started.ok).toBe(false);
      if (started.ok) return;
      expect(started.message).toContain(
        "A desktop app listens on 127.0.0.1 on a random port",
      );
    }
  });

  it("refuses run({ once: true })", async () => {
    const { start } = setup("once");

    const started = await start();
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.message).toContain("once: true");
  });

  it("fails an entry that never calls run()", async () => {
    const { start } = setup("no-run");

    const started = await start();
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.message).toContain("did not call run()");
  });

  it("terminates an app that is not ready within the readiness deadline", async () => {
    const { start } = setup("hang-start", { readyTimeoutMs: 1_000 });

    const started = await start();
    expect(started).toEqual({
      ok: false,
      message: "The app did not become ready within 1 seconds.",
    });
  });

  it("terminates an app whose stop hooks outlive the stop deadline, and never calls that graceful", async () => {
    const { supervisor, marker, start } = setup("hang-stop", {
      stopTimeoutMs: 1_000,
    });

    expect((await start()).ok).toBe(true);
    const stopped = await supervisor.stop();
    expect(stopped.graceful).toBe(false);
    expect(stopped.message).toContain("did not stop within 1 seconds");
    expect(existsSync(marker)).toBe(false);
  });

  it("reports a crash after readiness once", async () => {
    const { supervisor, start } = setup("normal");
    const crashes: string[] = [];
    supervisor.onCrash((message) => crashes.push(message));

    const started = await start();
    if (!started.ok) throw new Error(started.message);
    await fetch(`${started.origin}/crash`);
    await Bun.sleep(300);

    expect(crashes).toHaveLength(1);
    expect(crashes[0]).toContain("injected runtime crash");
    expect((await supervisor.stop()).graceful).toBe(false);
  });
});
