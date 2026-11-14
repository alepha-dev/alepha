import { ReportsSummaryRegistry } from "@lore/core/api";
import { CoreTestEntities, createTestProject } from "@lore/core/testing";
import { ReportsSummaryMarkdown } from "@lore/core/web";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * The Summary tab's lines (#Q2999): each module's, gated by its capability.
 */
describe("ReportsSummaryRegistry", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    bootLore(alepha);
    alepha.inject(CoreTestEntities);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  it("reads only the capabilities a project has", async ({ expect }) => {
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "plan" }],
    });

    const lines = await alepha
      .inject(ReportsSummaryRegistry)
      .lines(project.id, {});

    expect(new Set(lines.map((line) => line.capability))).toEqual(
      new Set(["plan"]),
    );
  });

  it("registers a line for every capability that has one", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha, {
      capabilities: [
        { key: "plan", options: { feedback: true } },
        { key: "remember" },
        { key: "ship" },
      ],
    });

    const lines = await alepha
      .inject(ReportsSummaryRegistry)
      .lines(project.id, {});

    expect(new Set(lines.map((line) => line.capability))).toEqual(
      new Set(["plan", "remember", "ship"]),
    );
  });

  it("gives a period figure a previous one, and a snapshot none", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "plan" }],
    });

    const lines = await alepha
      .inject(ReportsSummaryRegistry)
      .lines(project.id, {
        from: new Date(Date.now() - 86_400_000).toISOString(),
      });

    const byKey = new Map(lines.map((line) => [line.key, line]));
    expect(byKey.get("throughput")?.previous).toBe(0);
    expect(byKey.get("wip")?.previous).toBeUndefined();
  });
});

describe("ReportsSummaryMarkdown", () => {
  it("renders the lines as a list, with the previous figure", ({ expect }) => {
    const text = new ReportsSummaryMarkdown().render(
      "Lore",
      [
        {
          key: "throughput",
          capability: "plan",
          value: 4,
          previous: 2,
          format: "count",
        },
        { key: "wip", capability: "plan", value: 3, format: "count" },
      ],
      {
        line: (key) => key.toUpperCase(),
        format: (_line, value) => String(value),
      },
    );

    expect(text).toBe("## Lore\n\n- THROUGHPUT: 4 (was 2)\n- WIP: 3");
  });
});
