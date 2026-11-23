import { codeHref } from "./codeHref.ts";

/**
 * The tabs of a repository's plate (#Q4133), in order: each later quest of
 * #E167 adds its own. `routes` are the pages that light the tab.
 */
export interface CodeRepoTab {
  key: string;
  labelKey: string;
  /**
   * Where the tab opens, from the project, the repository and its default
   * branch: a wildcard page is linked by path, never by name.
   */
  href: (
    projectSlug: string,
    repoSlug: string,
    defaultBranch: string,
  ) => `/${string}`;
  routes: string[];
}

export const CODE_REPO_TABS: CodeRepoTab[] = [
  {
    key: "files",
    labelKey: "code.tab.files",
    href: (projectSlug, repoSlug) => `/${projectSlug}/code/${repoSlug}`,
    routes: ["codeRepoHome", "codeRepoTree", "codeRepoBlob"],
  },
  {
    key: "commits",
    labelKey: "code.tab.commits",
    href: (projectSlug, repoSlug, branch) =>
      codeHref("commits", projectSlug, repoSlug, branch),
    routes: ["codeRepoCommits", "codeRepoCommit"],
  },
  {
    key: "branches",
    labelKey: "code.tab.branches",
    href: (projectSlug, repoSlug) =>
      `/${projectSlug}/code/${repoSlug}/branches`,
    routes: ["codeRepoBranches", "codeRepoCompare"],
  },
  {
    key: "tags",
    labelKey: "code.tab.tags",
    href: (projectSlug, repoSlug) => `/${projectSlug}/code/${repoSlug}/tags`,
    routes: ["codeRepoTags"],
  },
];
