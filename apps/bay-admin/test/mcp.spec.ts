import { Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { describe, expect, it } from "vitest";
import { errorGroups } from "../src/api/entities/errorGroups.ts";
import { pulseApps } from "../src/api/entities/pulseApps.ts";
import { BayAdminApi } from "../src/api/index.ts";
import { AppKeyService } from "../src/api/services/AppKeyService.ts";
import { IngestService } from "../src/api/services/IngestService.ts";
import { PulseMcp } from "../src/mcp/index.ts";
import { PulseTools } from "../src/mcp/tools/PulseTools.ts";

class Probe {
  apps = $repository(pulseApps);
  errors = $repository(errorGroups);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  })
    .with(BayAdminApi)
    .with(PulseMcp);
  const tools = alepha.inject(PulseTools);
  const ingest = alepha.inject(IngestService);
  const keys = alepha.inject(AppKeyService);
  const probe = alepha.inject(Probe);
  await alepha.start();

  const key = keys.generate();
  const app = await probe.apps.create({
    slug: "demo",
    name: "Demo",
    kind: "external",
    ingestKeyHash: key.hash,
    ingestKeyPrefix: key.prefix,
  });

  return { alepha, tools, ingest, probe, app };
};

const anError = (message: string, frame = "at f (app.js:1:1)") => ({
  name: "TypeError",
  message,
  stack: `TypeError: ${message}\n    ${frame}`,
  sourceUrl: "https://app/",
});

describe("PulseTools", () => {
  it("reports an app that has never reported as such", async () => {
    const { tools } = await setup();

    const { apps } = await tools.apps_status.execute({});

    // Distinct from "silent": an app that has never once checked in is a
    // configuration problem, not an outage.
    expect(apps[0].status).toBe("never reported");
  });

  it("returns one row per distinct failure, with its count", async () => {
    const { tools, ingest, app } = await setup();

    await ingest.absorb(app, { errors: [{ ...anError("boom"), count: 30 }] });
    await ingest.absorb(app, { errors: [{ ...anError("boom"), count: 12 }] });

    const { errors } = await tools.errors_list.execute({ slug: "demo" });

    expect(errors).toHaveLength(1);
    expect(errors[0].count).toBe(42);
  });

  it("says when it truncated, instead of implying that was everything", async () => {
    const { tools, ingest, app } = await setup();

    for (let i = 0; i < 5; i++) {
      await ingest.absorb(app, {
        errors: [anError("boom", `at f${i} (app.js:1:1)`)],
      });
    }

    const { errors, truncated } = await tools.errors_list.execute({
      slug: "demo",
      limit: 2,
    });

    expect(errors).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  it("refuses an unknown app by name rather than answering empty", async () => {
    const { tools } = await setup();

    // An empty result would read as "this app is healthy".
    await expect(
      tools.errors_list.execute({ slug: "nope" }),
    ).rejects.toThrowError(/nope/);
  });

  it("hands back the first stack sample, not the latest", async () => {
    const { tools, ingest, app } = await setup();

    await ingest.absorb(app, { errors: [anError("first")] });
    await ingest.absorb(app, { errors: [anError("second")] });

    const { errors } = await tools.errors_list.execute({ slug: "demo" });
    const detail = await tools.errors_get.execute({
      slug: "demo",
      fingerprint: errors[0].fingerprint,
    });

    expect(detail.stackSample).toContain("first");
  });
});
