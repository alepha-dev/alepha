import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it } from "vitest";

import {
  defaultProjectFeatures,
  projectFeaturesSchema,
} from "@/api/entities/projects.ts";

/**
 * `projects.features` is frozen, and this is what keeps it frozen.
 *
 * ⚠️ **A `@deprecated` block does not stop anybody.** The column is still on
 * the entity, still typed, still populated on every row, and it still reads
 * like the natural place to put a project-level switch - which is exactly how
 * a future session reaches for it. The deprecation says why not; this says so
 * in a way that goes red.
 *
 * Two rules, and they are different rules:
 *
 * - **Nothing reads it.** One grep over `src/`, comments excluded, allowing
 *   only the writes that keep old rows decodable. The whole point of epic #36
 *   is that four gates moved to `project_capabilities`; a read here is one of
 *   them moving back.
 * - **The DEFAULT does not move.** `defaultProjectFeatures` is the column's
 *   `DEFAULT` clause, drizzle-kit turns a changed DEFAULT into a table
 *   rebuild, and on D1 `DROP TABLE projects` cascade-wipes members, quests,
 *   releases, folios and feedback. That already happened once, on 2026-05-13,
 *   from a migration that flipped exactly these four booleans.
 */
describe("projects.features stays frozen", () => {
  const root = path.resolve(import.meta.dirname, "..", "src");

  /**
   * Every `.ts`/`.tsx` file under `src/`.
   */
  const sources = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });

  /**
   * The file with block comments, line comments and string literals removed,
   * so a paragraph explaining the history does not read as a use of it.
   *
   * Crude on purpose: a real parser here would be a dependency and a second
   * thing to be wrong, and the only false negative this can produce is a
   * `features` read written inside a string, which is not a thing anyone does.
   */
  const code = (file: string): string =>
    fs
      .readFileSync(file, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/`(?:[^`\\]|\\.)*`/g, " ")
      .replace(/"(?:[^"\\]|\\.)*"/g, " ")
      .replace(/'(?:[^'\\]|\\.)*'/g, " ");

  it("is read by nothing in src/", ({ expect }) => {
    /**
     * ⚠️ **READS only, never writes.** `features:` as an object key is
     * allowed and has to be: `createProject` and `projectFixture` both stamp
     * the frozen default so a row decodes, and `$realm({ features: … })` in
     * `AppSecurityProvider` is an unrelated framework concept that happens to
     * share the word. What must not exist is a place that asks the column
     * what a project does - a member read, or a destructure of one.
     */
    const READ = /(?:\?\.|\.)features\b/;
    const DESTRUCTURE = /\{[^{}]*\bfeatures\b[^{}]*\}\s*=/;

    const offenders = sources(root)
      // The entity is where the column is declared, so the name has to be
      // there. Nowhere else may reach it.
      .filter(
        (file) => file !== path.join(root, "api", "entities", "projects.ts"),
      )
      .filter((file) => {
        const body = code(file);
        return READ.test(body) || DESTRUCTURE.test(body);
      })
      .map((file) => path.relative(root, file));

    // The message is the fix: a session that lands here wanted a project-level
    // switch, and `project_capabilities` is where those live.
    expect(
      offenders,
      "read `project_capabilities` instead - `ProjectSecurityService.capabilitiesOf` on the server, `hasCapability` / `capabilityOption` in the browser",
    ).toEqual([]);
  });

  it("writes exactly the four keys it has always written", ({ expect }) => {
    // ⚠️ Not "these four are true" - that the SET is these four. A fifth key
    // here changes the column DEFAULT, and a changed DEFAULT on `projects` is
    // the 2026-05-13 rebuild that cascade-wiped production.
    expect(Object.keys(defaultProjectFeatures).sort()).toEqual([
      "feedback",
      "folios",
      "kanban",
      "milestones",
    ]);
    expect(defaultProjectFeatures).toEqual({
      kanban: true,
      folios: true,
      feedback: true,
      milestones: true,
    });
  });

  it("keeps `milestones` as the key Releases is stored under", ({ expect }) => {
    // The required-key rule, from the other side: `milestones` renamed to
    // `releases` would leave all 54 production rows missing a required key,
    // and a missing required key fails the WHOLE row rather than reading as
    // undefined - every query touching `projects` throws. That is the
    // 2026-08-05 incident verbatim. The capability option is called
    // `releases`, which is what moving the storage bought.
    const shape = projectFeaturesSchema.shape;
    expect(shape.milestones).toBeDefined();
    expect("releases" in shape).toBe(false);

    // The four required ones, which is what makes a rename fatal rather than
    // merely wrong.
    for (const key of ["kanban", "folios", "feedback", "milestones"]) {
      expect(
        projectFeaturesSchema.safeParse({}).success,
        `${key} must stay required`,
      ).toBe(false);
    }
  });
});
