import { describe, it } from "vitest";

import { artifactManifestSchema } from "../src/api/schemas/artifactManifestSchema.ts";

/**
 * `alepha build` adds `surface` to `manifest.json` (#Q3401): each
 * controller's purity and every primitive a runtime needs without creating
 * its class. Lore reads a narrow subset of the manifest; the new field must
 * neither be refused nor dropped, since the artifact page will read it.
 */
describe("the artifact manifest with a build list", () => {
  it("accepts and keeps the surface field", ({ expect }) => {
    const surface = {
      version: 1,
      classes: [{ key: "lore.work.api:QuestController", pure: true }],
      actions: [
        {
          name: "getQuests",
          group: "QuestController",
          method: "GET",
          path: "/quests",
          class: "lore.work.api:QuestController",
        },
      ],
    };
    const parsed = artifactManifestSchema.parse({
      manifestVersion: 2,
      runtimes: [{ runtime: "workerd" }],
      surface,
    }) as Record<string, unknown>;

    expect(parsed.surface).toEqual(surface);
  });
});
