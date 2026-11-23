/**
 * The `lore clone` argument for a repository: `<project>` for the one named
 * like its project, `<project>/<repo>` otherwise, as its clone URL reads.
 */
export const loreCloneTarget = (projectSlug: string, repoSlug: string) =>
  repoSlug === projectSlug ? projectSlug : `${projectSlug}/${repoSlug}`;
