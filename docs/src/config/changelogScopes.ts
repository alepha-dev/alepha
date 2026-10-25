/**
 * The scope filter behind `/changelog?scope=…`.
 *
 * A change's scope is the commit's own scope, normalised in `gen-tree.ts` to
 * the module path it names (`users` is read as `api/users`). This module turns
 * that into something a reader can filter by, in two layers:
 *
 * - `?scope=orm,react` is the raw form: a comma-separated list of tokens,
 *   matched against a scope name by name, so `api` selects `api/users` and
 *   `api/users` selects it too.
 * - The six buttons above the timeline write a *group* id into that same
 *   param. Four of them (`cli`, `ui`, `lore`, `bay`) are also real scope
 *   tokens, so a hand-typed `?scope=ui` and the UI button agree; the group is
 *   simply the wider reading, taking `devtools` along with `ui`.
 *
 * `framework` is the one id that is not a scope: it is defined as everything
 * the other four groups do not claim. Written as a complement rather than a
 * list because a list is wrong the moment a module is added, and wrong in the
 * direction nobody notices - a new module would quietly appear under no filter
 * at all.
 *
 * ⚠️ Groups are decided per comma-separated scope, and on its *namespace* -
 * the segment before the first `/`. A commit scoped `analytics,ui,lore`
 * changed a framework module, the UI and Lore, and is shown under all three;
 * matching on every slash segment instead would have made `ui/admin` framework
 * work, because `admin` is nobody's module.
 */

export interface ChangelogScopeGroup {
  id: string;
  label: string;
}

/**
 * The buttons, in the order they are shown. `all` is the absence of a filter
 * and never reaches the URL.
 */
export const changelogScopeGroups: ChangelogScopeGroup[] = [
  { id: "all", label: "All" },
  { id: "framework", label: "Framework" },
  { id: "cli", label: "CLI" },
  { id: "ui", label: "UI" },
  { id: "lore", label: "Lore" },
  { id: "bay", label: "Bay" },
];

/**
 * The namespaces each named group claims, beyond its own name.
 *
 * `platform`, `vite` and `build` sit with `cli` because they are the build and
 * deploy chain the CLI drives. `devtools` sits with `ui` because it is one, and
 * so do `admin` and `admin-ui`, which is what the admin components were scoped
 * before `ui/admin` settled.
 *
 * `payments-stripe` is deliberately in no group: it is the published package,
 * not a surface of `payments`, so it belongs to the framework.
 */
const GROUP_SCOPES: Record<string, string[]> = {
  cli: ["cli", "command", "platform", "vite", "build"],
  ui: ["ui", "devtools", "admin", "admin-ui"],
  lore: ["lore"],
  bay: ["bay"],
};

/**
 * The groups `framework` is the complement of.
 */
const NON_FRAMEWORK_GROUPS = ["cli", "ui", "lore", "bay"];

/**
 * Read the `scope` param into the tokens to filter on. An empty or absent
 * param means no filter, which is what `all` writes.
 */
export const parseChangelogScope = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0 && token !== "all");

/**
 * Whether a change's scope is selected by the given tokens. No tokens means
 * everything, so an unfiltered page needs no special case at the call site.
 */
export const matchesChangelogScope = (
  scope: string,
  tokens: string[],
): boolean => {
  if (tokens.length === 0) return true;
  const parts = partsOf(scope);
  return tokens.some((token) => matchesToken(parts, token));
};

const matchesToken = (parts: string[], token: string): boolean => {
  if (token === "framework") {
    return parts.some((part) => !isClaimed(part));
  }

  const group = GROUP_SCOPES[token];
  if (group) {
    return parts.some((part) => group.includes(namespaceOf(part)));
  }

  // A raw token: the whole scope, or one of its `/` segments, so `?scope=api`
  // and `?scope=users` both reach `api/users`.
  return parts.some(
    (part) => part === token || part.split("/").includes(token),
  );
};

const isClaimed = (part: string): boolean =>
  NON_FRAMEWORK_GROUPS.some((group) =>
    GROUP_SCOPES[group].includes(namespaceOf(part)),
  );

const partsOf = (scope: string): string[] =>
  scope
    .toLowerCase()
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const namespaceOf = (part: string): string => part.split("/")[0];
