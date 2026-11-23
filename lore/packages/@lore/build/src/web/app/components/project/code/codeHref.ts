/**
 * The code browser's URLs (#E167). Alepha's router matches a trailing `*`
 * but does not compile one, so the pages under `/tree/*`, `/blob/*` and
 * the rest are linked by these, every segment encoded on its own so a
 * branch named `feat/x` keeps its slash.
 */
export type CodePageKind = "tree" | "blob" | "commits" | "blame";

export const encodeCodePath = (path: string): string =>
  path
    .split("/")
    .filter((segment) => segment !== "")
    .map(encodeURIComponent)
    .join("/");

/**
 * A wildcard capture back to its text, segment by segment; a segment that
 * is not valid percent-encoding is kept as it came.
 */
export const decodeCodePath = (wildcard: string | undefined): string =>
  (wildcard ?? "")
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");

export const codeHref = (
  kind: CodePageKind,
  projectSlug: string,
  repoSlug: string,
  revision: string,
  path = "",
): `/${string}` => {
  const tail = [encodeCodePath(revision), encodeCodePath(path)]
    .filter(Boolean)
    .join("/");
  return `/${projectSlug}/code/${repoSlug}/${kind}/${tail}`;
};

/**
 * The raw download of a file, by commit sha so an image keeps pointing at
 * the bytes the page showed.
 */
export const codeRawHref = (
  projectId: number,
  repoSlug: string,
  sha: string,
  path: string,
): `/${string}` =>
  `/api/projects/${projectId}/code/repos/${repoSlug}/raw/${sha}/${encodeCodePath(path)}`;

/**
 * A link or an image in a repository's Markdown, resolved against the
 * folder of the file that holds it: `undefined` for anything that leaves the
 * repository (a scheme, `//host`, a bare `#anchor`), the repository path
 * otherwise. A leading `/` is the repository's root, as on a forge.
 */
export const resolveCodeLink = (
  base: string,
  href: string | undefined,
): { path: string; hash: string; folder: boolean } | undefined => {
  if (!href || href.startsWith("#") || href.startsWith("//")) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined;
  const [withoutHash = "", hash = ""] = href.split("#", 2);
  const [target = ""] = withoutHash.split("?", 1);
  const folder = target.endsWith("/");
  const segments = target.startsWith("/")
    ? []
    : base.split("/").filter(Boolean);
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    segments.push(decodeCodePath(segment));
  }
  return { path: segments.join("/"), hash: hash ? `#${hash}` : "", folder };
};

/**
 * The folder holding `path`.
 */
export const dirnameOf = (path: string): string =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/**
 * `#L12` or `#L12-L20` read as a line range, in order.
 */
export const parseLineHash = (hash: string): [number, number] | undefined => {
  const match = /^#L(\d+)(?:-L(\d+))?$/.exec(hash);
  if (!match) return undefined;
  const a = Number(match[1]);
  const b = Number(match[2] ?? match[1]);
  return a <= b ? [a, b] : [b, a];
};
