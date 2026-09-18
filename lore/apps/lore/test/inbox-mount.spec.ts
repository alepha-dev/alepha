import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, it } from "vitest";

/**
 * Where the bell may be mounted, asserted against the source.
 *
 * ⚠️ **This is the only thing standing between the owner's ruling and a
 * later tidy-up.** The bell renders on the project shell and on the landing
 * page - never on `/account`, never on `/admin` - and the natural refactor is
 * to "unify" it into `AppActions` with the other four icons. That component's
 * whole argument is that it holds the ambient controls EVERY signed-in surface
 * carries and has no `show` props; a bell there would be on two shells it was
 * ruled off.
 *
 * ⚠️ The landing page is the SECOND mount, and it is new: the rule was "the
 * project shell only" until the owner specified a bell in the home header
 * alongside the ambient controls. It is `ButtonInbox` directly rather than
 * `ProjectInboxButton`, which needs a current project for its "see all" link;
 * home sends that link to the account's notifications page instead. The count
 * behind both is cross-project and always was.
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

const filesMentioning = (root: string, needle: string | RegExp): string[] =>
  walk(root).filter((path) => {
    const source = readFileSync(path, "utf8");
    return typeof needle === "string"
      ? source.includes(needle)
      : needle.test(source);
  });

describe("where the inbox bell is mounted", () => {
  it("is imported by exactly the two components allowed to mount it", ({
    expect,
  }) => {
    // The bell is one name in a module every shell imports, so the needle is
    // the name inside an import of `@alepha/ui/shell`, not the specifier.
    const importers = filesMentioning(
      SRC,
      /import\s*\{[^}]*\bButtonInbox\b[^}]*\}\s*from\s*"@alepha\/ui\/shell"/,
    ).map((path) => path.slice(SRC.length + 1));

    expect(importers.sort()).toEqual(
      [
        join("web", "app", "components", "home", "HomeHeader.tsx"),
        join("web", "app", "components", "project", "ProjectInboxButton.tsx"),
      ].sort(),
    );
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
    const cluster = readFileSync(join(UI, "shell", "AppActions.tsx"), "utf8");

    expect(cluster).not.toContain("ButtonInbox");
    expect(cluster).not.toContain("ButtonInbox.tsx");
  });
});
