/**
 * `origin` is what the provider says about each node: `registered` (a
 * `$parameter` declares it, nothing saved), `orphan` (saved, nothing
 * declares it) or `both`. A folder carries what its leaves agree on.
 */
export interface ParamNode {
  name: string;
  path: string;
  isLeaf: boolean;
  origin: "registered" | "orphan" | "both";
  children: ParamNode[];
}

/**
 * The tree without its orphans: an orphan leaf goes, and a folder whose
 * leaves were all orphans goes with them. A folder that is also a live leaf
 * keeps its row.
 */
export const pruneOrphans = (nodes: ParamNode[]): ParamNode[] =>
  nodes.flatMap((node) => {
    if (node.origin === "orphan") return [];
    const children = pruneOrphans(node.children);
    return [{ ...node, children }];
  });

export const countOrphanLeaves = (nodes: ParamNode[]): number => {
  let count = 0;
  const walk = (n: ParamNode) => {
    if (n.isLeaf && n.origin === "orphan") count += 1;
    for (const c of n.children) walk(c);
  };
  for (const n of nodes) walk(n);
  return count;
};

export const collectLeafNames = (nodes: ParamNode[]): string[] => {
  const out: string[] = [];
  const walk = (n: ParamNode) => {
    if (n.isLeaf) out.push(n.path);
    for (const c of n.children) walk(c);
  };
  for (const n of nodes) walk(n);
  return out;
};

/**
 * The label of one node of the tree, keyed by its full dotted path
 * (`parameters.courts.pricing`, `parameters.courts`), falling back to the
 * English title case of the last segment when the app has no dictionary
 * entry, so a parameters tree always renders, localized or not.
 *
 * ⚠️ A label, never a rename. `$parameter` stores overrides under the exact
 * name, so renaming `lore.campaign.limits` to read better would orphan the row
 * an admin saved and fall back to the code default without a word.
 *
 * `api` is the framework's own namespace (`api.notifications`,
 * `api.realms.<realm>`): every app has it, so its label ships here rather
 * than in each app's dictionary. It is written as a literal call so the
 * French catalogue's coverage test can see it; an app's own entry still wins.
 */
export const parameterLabel = (
  tr: (key: string, options: { default: string }) => string,
  path: string,
): string => {
  if (path === "api") {
    return tr("parameters.api", { default: "System" });
  }
  const last = path.split(".").pop() ?? path;
  return tr(`parameters.${path}`, {
    default: last
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
  });
};
