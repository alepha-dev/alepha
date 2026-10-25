import {
  AutomationContextBuilder,
  AutomationTemplateRenderer,
} from "@lore/core/api";
import {
  AutomationTemplateBindings,
  AutomationTemplateTokens,
  type AutomationTemplateVariable,
  type AutomationRule,
} from "@lore/core/schemas";
import { Alepha } from "alepha";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  TestEntityRepositories,
  createTestProject,
} from "./fixtures/entities.ts";

describe("Automation template boundary", () => {
  let alepha: Alepha;
  let builder: AutomationContextBuilder;
  let renderer: AutomationTemplateRenderer;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  const notify = (text: string): AutomationRule["actions"][number] => ({
    kind: "notify",
    recipient: project.createdBy,
    channel: "inbox",
    title: "A custom title",
    text,
    category: "automations",
  });
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "error" },
    });
    bootLore(alepha);
    builder = alepha.inject(AutomationContextBuilder);
    renderer = alepha.inject(AutomationTemplateRenderer);
    alepha.inject(TestEntityRepositories);
    await alepha.start();
    project = await createTestProject(alepha);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("shares lexical grammar and native values without rescanning injected data", ({
    expect,
  }) => {
    const bindings = new AutomationTemplateBindings();
    const variables = new Map<string, AutomationTemplateVariable>([
      [
        "limit",
        {
          kind: "number",
          available: true,
          value: { kind: "number", value: 0 },
        },
      ],
      [
        "prose",
        {
          kind: "text",
          available: true,
          value: { kind: "text", value: "{{secret}}" },
        },
      ],
    ]);
    const resolve = (
      value: unknown,
      kind: "text" | "number" | "boolean",
      template = false,
    ) =>
      bindings.resolve({
        slot: { kind, required: true, template },
        value,
        fields: { flag: "boolean" },
        context: { flag: false },
        variables,
        path: "test",
      });
    expect(resolve("{{ limit }}", "number").value).toBe(0);
    expect(resolve("{{flag}}", "boolean").value).toBe(false);
    expect(resolve("Limit {{limit}} and {{prose}}", "text", true).value).toBe(
      "Limit 0 and {{secret}}",
    );
    expect(() => resolve("Value {{limit}}", "number")).toThrow(
      "mixed interpolation",
    );
    expect(() => resolve("{{flag}}", "number")).toThrow("expected 'number'");
    for (const syntax of [
      "{{title.path}}",
      "{{a + b}}",
      "{{#each items}}",
      "{{broken",
      "end}}",
    ])
      expect(() => new AutomationTemplateTokens().names(syntax)).toThrow(
        "Invalid placeholder",
      );
    expect(() => resolve("{{constructor}}", "text")).toThrow(
      "unknown placeholder",
    );
    expect(() =>
      bindings.resolve({
        slot: { kind: "textArray", required: true, min: 2 },
        value: ["one"],
        fields: {},
        variables,
        path: "array",
      }),
    ).toThrow("bounds");
  });

  it("allows only declared safe context fields and uses the authoritative project title", async ({
    expect,
  }) => {
    const context = await builder.source(project.id, "deploy.failed", {
      project: "Spoofed",
      title: "Deploy failed",
      app: "site",
      env: "production",
      reason: "Build failed",
      credentials: "secret",
      reporterEmail: "private@example.test",
      logs: "private logs",
      url: "/lore/deployments/1?token=secret",
    });
    expect(context.values).toEqual({
      project: project.title,
      title: "Deploy failed",
      app: "site",
      env: "production",
      reason: "Build failed",
      url: "/lore/deployments/1",
    });
    for (const name of ["credentials", "reporterEmail", "logs"])
      expect(() => renderer.render(notify(`{{${name}}}`), context, [])).toThrow(
        "unknown placeholder",
      );
    await expect(
      builder.source(project.id, "deploy.failed", {
        url: "javascript:alert(1)",
      }),
    ).rejects.toThrow("safe HTTP");
    await expect(
      builder.source(project.id, "deploy.failed", {
        url: "https://user:secret@example.test",
      }),
    ).rejects.toThrow("safe HTTP");
  });

  it("escapes final output while preserving stored prose and literal placeholder values", async ({
    expect,
  }) => {
    const context = await builder.source(project.id, "feedback.created", {
      title: '<img src=x onerror="bad()"> {{secret}} & @everyone',
    });
    const action = notify("Custom: {{ title }}");
    const html = renderer.render(action, context, [], "html");
    expect(html.suppressed).toBe(false);
    if (
      html.suppressed ||
      html.action.kind !== "notify" ||
      html.raw.kind !== "notify"
    )
      return;
    expect(html.action.text).toContain("&lt;img");
    expect(html.action.text).toContain("&quot;");
    expect(html.action.text).toContain("{{secret}}");
    expect(html.raw.text).toContain("<img");
    expect(action).toEqual(notify("Custom: {{ title }}"));
    const discord = renderer.render(action, context, [], "discord");
    expect(JSON.stringify(discord)).toContain("@\u200beveryone");
  });

  it("produces one sorted digest, truthful lower bounds and no empty delivery", async ({
    expect,
  }) => {
    const context = await builder.collection(
      project.id,
      "quests.tagged",
      {
        items: [
          { shortId: 9, title: "Later", reporterEmail: "private@example.test" },
          { shortId: 2, title: "First\nline" },
        ],
        hasMore: true,
      },
      { tag: "daily" },
    );
    const result = renderer.render(notify("{{summary}}"), context, []);
    expect(result.suppressed).toBe(false);
    if (result.suppressed || result.action.kind !== "notify") return;
    expect(result.action.text).toBe(
      'At least 3 matching quests tagged "daily"; 2 of 2 selected quests shown.\nQuest 2: First line\nQuest 9: Later',
    );
    expect(result.truncated).toBe(true);
    expect(context.collection?.totalIsExact).toBe(false);
    expect(JSON.stringify(context)).not.toContain("private@example.test");
    const empty = await builder.collection(project.id, "quests.tagged", {
      items: [],
      total: 0,
      totalIsExact: true,
    });
    expect(() => renderer.render(notify("{{unknown}}"), empty, [])).toThrow(
      "unknown placeholder",
    );
    expect(renderer.render(notify("{{summary}}"), empty, [])).toMatchObject({
      suppressed: true,
      reason: "empty_collection",
    });
    await expect(
      builder.collection(project.id, "quests.tagged", {
        items: [{ shortId: 1, title: "One" }],
        total: 0,
      }),
    ).rejects.toThrow("lower bound");
  });

  it("bounds selected items and shortens a digest without hiding omitted counts", async ({
    expect,
  }) => {
    const context = await builder.collection(project.id, "quests.tagged", {
      items: Array.from({ length: 51 }, (_, index) => ({
        shortId: index + 1,
        title: "<".repeat(500),
      })),
      total: 77,
      totalIsExact: true,
    });
    expect(context.collection?.items).toHaveLength(50);
    const result = renderer.render(notify("{{summary}}"), context, [], "html");
    expect(result.suppressed).toBe(false);
    if (result.suppressed || result.action.kind !== "notify") return;
    expect(result.bytes).toBeLessThanOrEqual(16_384);
    expect(result.shown).toBeLessThan(50);
    expect(result.truncated).toBe(true);
    expect(result.action.text).toContain(
      `77 matching quests; ${result.shown} of 50 selected quests shown.`,
    );
    expect(result.action.text).not.toContain("Quest 51:");
  });

  it("rejects byte overflow, unavailable values, wrong types and reserved variables", async ({
    expect,
  }) => {
    const context = await builder.source(project.id, "feedback.created", {
      title: "😀".repeat(5000),
      feedback_id: 3,
    });
    expect(() => renderer.render(notify("{{title}}"), context, [])).toThrow(
      "16 KiB",
    );
    expect(() => renderer.render(notify("{{missing}}"), context, [])).toThrow(
      "unknown placeholder",
    );
    expect(() => renderer.render(notify("{{shortId}}"), context, [])).toThrow(
      "unavailable",
    );
    expect(() =>
      renderer.render(
        { kind: "assignRelease", quest: "{{title}}", release: 2 },
        context,
        [],
      ),
    ).toThrow("expected 'number'");
    expect(() =>
      renderer.render(notify("Custom"), context, [
        { key: "title", version: 0, value: { kind: "text", value: "Spoof" } },
      ]),
    ).toThrow("reserved");
  });

  it("keeps stock language and custom prose identical regardless of caller metadata", async ({
    expect,
  }) => {
    const results: ReturnType<AutomationTemplateRenderer["render"]>[] = [];
    for (const caller of ["HTTP", "cron", "queue", "MCP"]) {
      const context = await builder.source(project.id, "release.published", {
        title: "v1.0",
        changelog: "A safe changelog",
        caller,
        lang: "another-language",
      });
      results.push(
        renderer.render(
          notify("My wording: {{title}}\n{{changelog}}"),
          context,
          [],
        ),
      );
    }
    expect(
      results.every(
        (result) => JSON.stringify(result) === JSON.stringify(results[0]),
      ),
    ).toBe(true);
    expect(results[0]).toMatchObject({
      lang: "en",
      action: { text: "My wording: v1.0\nA safe changelog" },
    });
  });
});
