import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, it } from "vitest";

/**
 * Where the bell may be mounted, asserted against the source.
 *
 * ⚠️ **This is the only thing standing between the owner's ruling and a
 * later tidy-up.** The bell renders in the project shell only - no
 * `/account`, no `/admin` - and the natural refactor is to "unify" it into
 * `AppActions` with the other four icons. That component's whole argument is
 * that it holds the ambient controls EVERY signed-in surface carries and has
 * no `show` props; a bell there would be on two shells it was ruled off.
 *
 * A source scan rather than a render test because the failure mode is a
 * moved import, and `app-routes.spec.ts` already sets the precedent for
 * guarding a rule that the type system cannot express.
 */
const SRC = join(import.meta.dirname, "..", "src");
const UI = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "packages",
  "@alepha",
  "ui",
  "src",
);

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
};

const filesMentioning = (root: string, needle: string): string[] =>
  walk(root).filter((path) => readFileSync(path, "utf8").includes(needle));

describe("where the inbox bell is mounted", () => {
  it("is imported by exactly one Lore component", ({ expect }) => {
    const importers = filesMentioning(
      SRC,
      'from "@alepha/ui/components/button-inbox/button-inbox"',
    ).map((path) => path.slice(SRC.length + 1));

    expect(importers).toEqual([
      join("web", "app", "components", "project", "ProjectInboxButton.tsx"),
    ]);
  });

  it("is rendered by ProjectView and by nothing else", ({ expect }) => {
    const users = filesMentioning(SRC, "<ProjectInboxButton").map((path) =>
      path.slice(SRC.length + 1),
    );

    expect(users).toEqual([
      join("web", "app", "components", "project", "ProjectView.tsx"),
    ]);
  });

  /**
   * The other half of the same rule, from the shared package's side: a bell
   * inside `AppActions` would appear on the account and admin shells too.
   */
  it("is not part of the AppActions cluster", ({ expect }) => {
    const cluster = readFileSync(
      join(UI, "components", "app-actions", "app-actions.tsx"),
      "utf8",
    );

    expect(cluster).not.toContain("ButtonInbox");
    expect(cluster).not.toContain("button-inbox");
  });
});
