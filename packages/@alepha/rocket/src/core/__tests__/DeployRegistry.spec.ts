import { Alepha } from "alepha";
import { describe, expect, test } from "vitest";
import { AlephaRocket } from "../index.ts";
import { DeployRegistry } from "../providers/DeployRegistry.ts";

const sampleBody = () => ({
  op: "up" as const,
  project: "club",
  env: "production",
  artifact: { bucket: "alepha-club-builds", key: "club-0.0.1.tar.gz" },
});

describe("DeployRegistry", () => {
  test("create + get round-trips a deploy in queued state", async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaRocket);
    await alepha.start();

    const registry = alepha.inject(DeployRegistry);
    const deploy = registry.create(sampleBody());

    expect(deploy.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(deploy.status).toBe("queued");
    expect(deploy.project).toBe("club");
    expect(registry.get(deploy.id)).toEqual(deploy);
  });

  test("status transitions: start → succeed", async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaRocket);
    await alepha.start();

    const registry = alepha.inject(DeployRegistry);
    const { id } = registry.create(sampleBody());

    registry.start(id);
    expect(registry.require(id).status).toBe("running");

    registry.append(id, "step 1\n");
    registry.append(id, "step 2\n");
    expect(registry.require(id).log).toBe("step 1\nstep 2\n");

    registry.succeed(id, "https://example.alepha.club");
    const final = registry.require(id);
    expect(final.status).toBe("succeeded");
    expect(final.deployedUrl).toBe("https://example.alepha.club");
    expect(final.finishedAt).toBeDefined();
  });

  test("fail captures the error message", async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } });
    alepha.with(AlephaRocket);
    await alepha.start();

    const registry = alepha.inject(DeployRegistry);
    const { id } = registry.create(sampleBody());

    registry.fail(id, new Error("wrangler deploy failed: 403"));
    const final = registry.require(id);
    expect(final.status).toBe("failed");
    expect(final.error).toBe("wrangler deploy failed: 403");
  });

  test("log buffer is capped at LOG_MAX_BYTES (tail kept)", async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaRocket);
    await alepha.start();

    const registry = alepha.inject(DeployRegistry);
    const { id } = registry.create(sampleBody());

    const oversized = "x".repeat(DeployRegistry.LOG_MAX_BYTES + 100);
    registry.append(id, oversized);
    const trimmed = registry.require(id).log;
    expect(trimmed.length).toBe(DeployRegistry.LOG_MAX_BYTES);
  });

  test("list returns deploys newest first", async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaRocket);
    await alepha.start();

    const registry = alepha.inject(DeployRegistry);
    const first = registry.create(sampleBody());
    await new Promise((r) => setTimeout(r, 5));
    const second = registry.create(sampleBody());

    const list = registry.list();
    expect(list.map((d) => d.id)).toEqual([second.id, first.id]);
  });
});
