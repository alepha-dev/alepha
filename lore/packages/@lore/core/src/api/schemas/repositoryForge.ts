/**
 * Where a project's commits and pull requests live on its forge (#Q4217),
 * built from the one repository URL a project names
 * (`projects.repositoryUrl`).
 *
 * One entry per forge, found from the URL's host. Forges differ only by the
 * paths a commit and a pull request take under the repository's root, so
 * adding one (GitLab's `/-/commit/` and `/-/merge_requests/`, Azure DevOps'
 * `/commit/` and `/pullrequest/`) is a row here, never a branch in a
 * component. GitHub is the one implemented; a URL on any other host links
 * nothing, since a link that 404s is worse than none (quest #1571).
 *
 * ⚠️ Relative imports only, none at all today: the api and the web both
 * import this file.
 */
export interface RepositoryForge {
  /**
   * The forge's name, for a reader of the code: never shown.
   */
  name: string;
  /**
   * Whether a repository URL is on this forge.
   */
  matches: (url: URL) => boolean;
  commitPath: (sha: string) => string;
  pullRequestPath: (number: number) => string;
}

export const REPOSITORY_FORGES: RepositoryForge[] = [
  {
    name: "github",
    matches: (url) => url.hostname.toLowerCase() === "github.com",
    commitPath: (sha) => `/commit/${sha}`,
    pullRequestPath: (number) => `/pull/${number}`,
  },
];

/**
 * The links of a repository on its forge, or `undefined` when the URL is
 * absent, not a URL, or on a forge Lore does not know.
 */
export interface RepositoryLinks {
  forge: string;
  commit: (sha: string) => string;
  pullRequest: (number: number) => string;
}

export const repositoryLinks = (
  repositoryUrl: string | null | undefined,
): RepositoryLinks | undefined => {
  if (!repositoryUrl) return undefined;
  let url: URL;
  try {
    url = new URL(repositoryUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const forge = REPOSITORY_FORGES.find((entry) => entry.matches(url));
  if (!forge) return undefined;
  // The root without a trailing slash, whatever was stored before the write
  // schema stripped it.
  const root = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return {
    forge: forge.name,
    commit: (sha) => `${root}${forge.commitPath(sha)}`,
    pullRequest: (number) => `${root}${forge.pullRequestPath(number)}`,
  };
};
