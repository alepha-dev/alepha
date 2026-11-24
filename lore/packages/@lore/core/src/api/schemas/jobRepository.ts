/**
 * The repository a read or write agent job is prepared from (#E173): the
 * project's repository URL as `https://github.com/<owner>/<name>`, the only
 * form Bay takes. GitHub through `gh` is required on an Agent host (the
 * epic's review, item 5): a URL elsewhere answers undefined, and the job is
 * refused before it is queued.
 *
 * Accepts what a member types: a trailing slash, a `.git` suffix, `www.`, an
 * ssh `git@github.com:owner/name.git`.
 */
export const jobRepositoryOf = (
  repositoryUrl: string | null | undefined,
): string | undefined => {
  const raw = repositoryUrl?.trim();
  if (!raw) return undefined;
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(raw);
  let owner: string | undefined;
  let name: string | undefined;
  if (ssh) {
    [, owner, name] = ssh;
  } else {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return undefined;
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "github.com" || !["https:", "http:"].includes(url.protocol)) {
      return undefined;
    }
    const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length !== 2) return undefined;
    [owner, name] = parts;
    name = name?.replace(/\.git$/i, "");
  }
  if (
    !owner ||
    !name ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) ||
    !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/.test(name) ||
    name.includes("..")
  ) {
    return undefined;
  }
  return `https://github.com/${owner}/${name}`;
};
