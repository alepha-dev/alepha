import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTestProject } from "@lore/core/testing";
import { describe, it } from "vitest";

import { docsCorpus } from "@/assistant/docs/docsCorpus.ts";
import { LoreDocsCorpusBuilder } from "@/assistant/docs/LoreDocsCorpusBuilder.ts";
import { LoreAiDocsController } from "@/assistant/index.ts";

import { bootAssistant } from "./fixtures/bootAssistant.ts";

const GUIDES = join(dirname(fileURLToPath(import.meta.url)), "../../../docs");

/**
 * How-to answers from Lore's own guides (#Q3212): a corpus generated from
 * the guides under `lore/docs`, searched per project, never returning a guide whose
 * capability the project has off, and linking only the docs site.
 */
describe("searchDocs", () => {
  it("serves a corpus generated from the guides as they are now", ({
    expect,
  }) => {
    const files = readdirSync(GUIDES, { recursive: true })
      .map((name) => String(name).split("\\").join("/"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => ({
        name,
        content: readFileSync(join(GUIDES, name), "utf8"),
      }));
    // Stale after a guide edit: run `yarn w lore docs:corpus`.
    expect(docsCorpus).toEqual(new LoreDocsCorpusBuilder().build(files));
    expect(docsCorpus.length).toBeGreaterThan(50);
    for (const section of docsCorpus) {
      expect(section.url).toMatch(
        /^https:\/\/alepha\.dev\/lore\/docs\/[a-z]+-[a-z-]+(#.*)?$/,
      );
    }
  });

  it("never returns a guide whose capability is off in the project", async ({
    expect,
  }) => {
    const { alepha, signIn } = await bootAssistant({ enabled: "1" });
    const docs = alepha.inject(LoreAiDocsController);
    const workOnly = await createTestProject(alepha, {
      capabilities: [{ key: "work" }, { key: "knowledge" }],
    });
    const everything = await createTestProject(alepha);
    const ask = async (projectId: number, q: string, userId: string) => {
      const { user } = await signIn(userId);
      return (
        await docs.searchDocs.run(
          { params: { projectId }, query: { q, limit: 8 } },
          { user },
        )
      ).sections;
    };

    const telemetry = "telemetry blights sigil feedback inbox";
    const allOn = await ask(everything.id, telemetry, everything.createdBy);
    expect(allOn.some((s) => s.url.includes("apps-telemetry"))).toBe(true);

    const narrowed = await ask(workOnly.id, telemetry, workOnly.createdBy);
    expect(narrowed.length).toBeGreaterThan(0);
    for (const section of narrowed) {
      const source = docsCorpus.find((it) => it.url === section.url)!;
      expect(["apps", "support"]).not.toContain(source.capability);
    }
    await alepha.stop();
  });

  it("answers a how-to with the section and its link", async ({ expect }) => {
    const { alepha, signIn } = await bootAssistant({ enabled: "1" });
    const project = await createTestProject(alepha);
    const { user } = await signIn(project.createdBy);
    const { sections } = await alepha
      .inject(LoreAiDocsController)
      .searchDocs.run(
        { params: { projectId: project.id }, query: { q: "shelve an epic" } },
        { user },
      );
    expect(sections[0].url).toContain("work-epics");
    await alepha.stop();
  });
});
