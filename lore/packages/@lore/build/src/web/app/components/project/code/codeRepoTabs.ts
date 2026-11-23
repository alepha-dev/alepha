/**
 * The tabs of a repository's plate (#Q4133), in order: each later quest of
 * #E167 adds its own. `routes` are the pages that light the tab.
 */
export interface CodeRepoTab {
  key: string;
  labelKey: string;
  /**
   * The route the tab opens, with `projectSlug` and `repoSlug` as params.
   */
  route: string;
  routes: string[];
}

export const CODE_REPO_TABS: CodeRepoTab[] = [
  {
    key: "files",
    labelKey: "code.tab.files",
    route: "codeRepoHome",
    routes: ["codeRepoHome", "codeRepoTree", "codeRepoBlob"],
  },
];
