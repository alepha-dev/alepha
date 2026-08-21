import type {
  GraphCluster,
  GraphDirection,
  GraphEdge,
  GraphEdgeStyle,
  GraphModel,
  GraphNode,
  GraphNodeShape,
} from "./graphModel.ts";

/**
 * Parse the text inside a ` ```mermaid ` fence into a `GraphModel`.
 *
 * Pure string in, data out: no layout knowledge, no DOM, no React. The
 * subset is mermaid's `flowchart` as agents actually write it, not as the
 * documentation leads with - inline node declarations, both label forms,
 * chains, fans, `<br/>`, and every bracket pair mermaid has, mapped onto
 * the four shapes the emitter draws.
 *
 * **It never throws and it never fails loudly.** The caller's fallback is
 * the original code block, so an unreadable statement is skipped and an
 * unreadable document returns `undefined`. Anything that is not a
 * `flowchart` / `graph` (a `sequenceDiagram`, a `gantt`) returns
 * `undefined` on the header line and degrades to the fence.
 */
export const parseFlowchart = (source: string): GraphModel | undefined => {
  try {
    return parseChecked(source);
  } catch {
    // A parser bug must cost the diagram, never the page it sits on.
    return undefined;
  }
};

const parseChecked = (source: string): GraphModel | undefined => {
  const statements = splitStatements(stripPreamble(source));
  if (statements.length === 0) return undefined;

  const header = /^(?:flowchart|graph)(?:\s+(TD|TB|BT|LR|RL))?\s*$/i.exec(
    statements[0],
  );
  if (!header) return undefined;

  const state: ParseState = {
    direction: header[1] ? normalizeDirection(header[1]) : "TB",
    nodes: new Map(),
    clusters: new Map(),
    edges: [],
    stack: [],
  };

  for (const statement of statements.slice(1)) {
    try {
      readStatement(statement, state);
    } catch {
      // Degrade, never fail: one bad statement must not lose the diagram.
    }
  }

  if (state.nodes.size === 0) return undefined;

  return {
    direction: state.direction,
    nodes: [...state.nodes.values()],
    clusters: [...state.clusters.values()],
    edges: retargetClusterEdges(state),
  };
};

interface ParseState {
  direction: GraphDirection;
  nodes: Map<string, GraphNode>;
  clusters: Map<string, GraphCluster>;
  edges: GraphEdge[];
  /** Open `subgraph` ids, innermost last. */
  stack: string[];
}

/**
 * Statements that carry styling or interaction rather than structure. Our
 * theme decides colours, so all of them are skipped in silence.
 */
const IGNORED =
  /^(?:classDef|class|style|linkStyle|click|accTitle|accDescr)\b/i;

const readStatement = (statement: string, state: ParseState): void => {
  if (!statement) return;
  if (IGNORED.test(statement)) return;
  // A `direction` inside a subgraph is parsed and ignored in v1: graphre
  // ranks the whole graph one way.
  if (/^direction\s+/i.test(statement)) return;

  if (/^end$/i.test(statement)) {
    state.stack.pop();
    return;
  }

  const subgraph = /^subgraph\s+(.*)$/i.exec(statement);
  if (subgraph) {
    openCluster(subgraph[1].trim(), state);
    return;
  }

  readEdgeStatement(statement, state);
};

/**
 * `subgraph id [Title]`, `subgraph id["Title"]` or `subgraph Title`, where
 * the title doubles as the id.
 */
const openCluster = (rest: string, state: ParseState): void => {
  const bracket = /^(\S+)\s*[[(]\s*(.*?)\s*[\])]$/.exec(rest);
  const id = bracket ? bracket[1] : rest;
  const label = bracket ? unquote(bracket[2]) : unquote(rest);
  if (!id) return;

  if (!state.clusters.has(id)) {
    state.clusters.set(id, {
      id,
      label: label || id,
      ...(state.stack.length
        ? { parent: state.stack[state.stack.length - 1] }
        : {}),
    });
  }
  state.stack.push(id);
};

const readEdgeStatement = (statement: string, state: ParseState): void => {
  const parts = splitOnLinks(statement);
  if (!parts) return;

  let previous: string[] | undefined;
  for (const part of parts) {
    const ids = part.group
      .split(/&/)
      .map((item) => declareNode(item.trim(), state))
      .filter((id): id is string => id !== undefined);
    if (ids.length === 0) {
      previous = undefined;
      continue;
    }
    if (previous && part.link) {
      for (const from of previous) {
        for (const to of ids) {
          state.edges.push({ from, to, ...part.link });
        }
      }
    }
    previous = ids;
  }
};

/**
 * Declare (or re-find) a node from one item of an edge statement.
 *
 * The first shape seen for an id wins, so a later bare mention of `A` keeps
 * the label `A[Start]` gave it. Getting that wrong produces a diagram where
 * every box shows a single letter.
 */
const declareNode = (item: string, state: ParseState): string | undefined => {
  // `A[Start]:::warn` - the class is a styling hook, and styling is ours.
  const text = item.replace(/:::[\w-]+\s*$/, "").trim();
  if (!text) return undefined;

  const open = text.search(/[[({>]/);
  const id = (open === -1 ? text : text.slice(0, open)).trim();
  if (!id || /\s/.test(id)) return undefined;

  const existing = state.nodes.get(id);
  if (existing) return id;

  // An id that names a subgraph is an edge endpoint, not a node. Declaring
  // it would put an empty box next to the cluster it means.
  if (state.clusters.has(id)) return id;

  const shaped = open === -1 ? undefined : readShape(text.slice(open));
  state.nodes.set(id, {
    id,
    lines: shaped ? shaped.lines : [id],
    shape: shaped ? shaped.shape : "rect",
    ...(state.stack.length
      ? { parent: state.stack[state.stack.length - 1] }
      : {}),
  });
  return id;
};

/**
 * Every mermaid bracket pair, longest opener first, mapped onto the four
 * shapes the emitter draws. The pairs that do not draw still have to be
 * CONSUMED, or their brackets end up in the label.
 */
const SHAPES: Array<[open: string, close: string, shape: GraphNodeShape]> = [
  ["(((", ")))", "circle"],
  ["([", "])", "rounded"],
  ["[[", "]]", "rect"],
  ["[(", ")]", "rect"],
  ["[/", "/]", "rect"],
  ["[\\", "\\]", "rect"],
  ["{{", "}}", "diamond"],
  ["((", "))", "circle"],
  [">", "]", "rect"],
  ["[", "]", "rect"],
  ["(", ")", "rounded"],
  ["{", "}", "diamond"],
];

const readShape = (
  text: string,
): { lines: string[]; shape: GraphNodeShape } | undefined => {
  for (const [open, close, shape] of SHAPES) {
    if (!text.startsWith(open)) continue;
    // `[/x\]` and `[\x/]` are trapezoids: same opener, the other closer.
    const closed =
      text.endsWith(close) ||
      (close.length === 2 && text.length > open.length && text.endsWith("]"));
    const body = closed
      ? text.slice(open.length, text.length - close.length)
      : text.slice(open.length);
    return { lines: splitLabelLines(unquote(body)), shape };
  }
  return undefined;
};

/**
 * `"quoted"` and `` `markdown` `` labels both come out as plain text: no
 * raw HTML is ever promoted to markup on this path, and a literal backtick
 * inside a box is the visible failure.
 */
const unquote = (raw: string): string => {
  let text = raw.trim();
  if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).trim();
  }
  if (text.length > 1 && text.startsWith("`") && text.endsWith("`")) {
    text = text.slice(1, -1).trim();
  }
  return text;
};

/**
 * `<br/>`, `<br>` and `<br />` are line breaks. Claude writes one in most
 * multi-word nodes, and with no raw HTML anywhere in `MarkdownView` the
 * literal tag would otherwise show up inside the box.
 */
const splitLabelLines = (label: string): string[] => {
  const lines = label
    .split(/<br\s*\/?>/i)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines : [label.trim()];
};

/**
 * The link operators, tried in this order at every position.
 *
 * The plain forms come FIRST on purpose: `A --- B --- C` is two links, and
 * the inline-text form would otherwise read the middle node as a label
 * (`--- B ---`). The inline-text forms then match only where a plain one
 * cannot, which is exactly where a label is.
 *
 * `<` is the only start marker supported. `o--o` / `x--x` are not, because
 * a leading `o` or `x` is indistinguishable from the last character of an
 * id - `box-->B` would lose its `x`.
 */
const LINK = new RegExp(
  [
    // plain: -.-> -.- -..->
    String.raw`(?<s1><)?(?<dash1>-\.+-+)(?<a1>[>ox])?`,
    // plain: ==> === ==x
    String.raw`(?<s2><)?(?<thick2>={3,}|={2,}(?=[>ox]))(?<a2>[>ox])?`,
    // plain: --> --- --o --x ---->
    String.raw`(?<s3><)?(?:-{3,}|-{2,}(?=[>ox]))(?<a3>[>ox])?`,
    // labelled: -. text .->
    String.raw`(?<s4><)?(?<dash4>-\.)\s*(?<t4>[^\n<>|]*?[^\n<>|\s.])\s*\.-+(?<a4>[>ox])?`,
    // labelled: == text ==>
    String.raw`(?<s5><)?(?<thick5>={2,})\s*(?<t5>[^\n<>|=]*?[^\n<>|=\s])\s*={2,}(?<a5>[>ox])?`,
    // labelled: -- text -->
    String.raw`(?<s6><)?-{2,}\s*(?<t6>[^\n<>|]*?[^\n<>|\s-])\s*-{2,}(?<a6>[>ox])?`,
  ].join("|"),
  "g",
);

interface LinkSpec {
  label?: string;
  style: GraphEdgeStyle;
  arrowStart: boolean;
  arrowEnd: boolean;
}

interface StatementPart {
  /** The node group left of `link`, or the whole statement for the first part. */
  group: string;
  /** The link that JOINS this group to the previous one. */
  link?: LinkSpec;
}

/**
 * Cut an edge statement into node groups and the links between them.
 * Returns `undefined` for a statement that holds no node at all.
 */
const splitOnLinks = (statement: string): StatementPart[] | undefined => {
  const parts: StatementPart[] = [];
  let cursor = 0;
  let pending: LinkSpec | undefined;

  LINK.lastIndex = 0;
  let match = LINK.exec(statement);
  while (match) {
    const groups = match.groups ?? {};
    // Read the style off WHICH alternative matched, never off the matched
    // text: an inline label is part of that text, so `-- v1.0 -->` and
    // `== 1.5x ==>` both looked dashed when this sniffed for a dot.
    const style: GraphEdgeStyle =
      (groups.dash1 ?? groups.dash4)
        ? "dashed"
        : (groups.thick2 ?? groups.thick5)
          ? "thick"
          : "solid";
    const label = groups.t4 ?? groups.t5 ?? groups.t6;
    const arrowEnd =
      groups.a1 ??
      groups.a2 ??
      groups.a3 ??
      groups.a4 ??
      groups.a5 ??
      groups.a6;
    const arrowStart =
      groups.s1 ??
      groups.s2 ??
      groups.s3 ??
      groups.s4 ??
      groups.s5 ??
      groups.s6;

    parts.push({ group: statement.slice(cursor, match.index), link: pending });
    cursor = match.index + match[0].length;

    // `-->|yes|` - the other label form, sitting after the operator.
    const piped = /^\s*\|([^|]*)\|/.exec(statement.slice(cursor));
    if (piped) cursor += piped[0].length;

    const text = piped ? piped[1] : label;
    pending = {
      ...(text?.trim()
        ? { label: splitLabelLines(unquote(text)).join("\n") }
        : {}),
      style,
      arrowStart: arrowStart === "<",
      arrowEnd: arrowEnd !== undefined,
    };

    LINK.lastIndex = cursor;
    match = LINK.exec(statement);
  }

  parts.push({ group: statement.slice(cursor), link: pending });
  return parts.some((p) => p.group.trim()) ? parts : undefined;
};

/**
 * Point every edge that names a `subgraph` at one of its member nodes.
 *
 * graphre throws outright on an edge whose endpoint is a cluster
 * (`Cannot set properties of undefined (setting 'rank')`), the same
 * limitation dagre has, so this must happen before the model leaves the
 * parser. A cluster with no node anywhere inside it has nothing to re-target
 * to, and the edge is dropped - visibly less than mermaid draws, but the
 * alternative is no diagram at all.
 */
const retargetClusterEdges = (state: ParseState): GraphEdge[] => {
  const out: GraphEdge[] = [];
  for (const edge of state.edges) {
    const from = state.clusters.has(edge.from)
      ? firstMember(edge.from, state)
      : edge.from;
    const to = state.clusters.has(edge.to)
      ? firstMember(edge.to, state)
      : edge.to;
    if (!from || !to) continue;
    out.push({
      ...edge,
      from,
      to,
      ...(from === edge.from ? {} : { fromCluster: edge.from }),
      ...(to === edge.to ? {} : { toCluster: edge.to }),
    });
  }
  return out;
};

const firstMember = (
  clusterId: string,
  state: ParseState,
): string | undefined => {
  for (const node of state.nodes.values()) {
    if (node.parent === clusterId) return node.id;
  }
  for (const cluster of state.clusters.values()) {
    if (cluster.parent !== clusterId) continue;
    const nested = firstMember(cluster.id, state);
    if (nested) return nested;
  }
  return undefined;
};

/**
 * Drop the YAML frontmatter block and any `%%{init: …}%%` directives, both
 * of which mermaid allows above the header line.
 */
const stripPreamble = (source: string): string =>
  source
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/%%\{[\s\S]*?\}%%/g, "");

/**
 * Cut the source into statements on newlines and `;`, dropping `%%`
 * comments. Quotes and brackets are tracked so a `;` inside a label does not
 * end the statement, and a `%` inside one is not read as a comment.
 */
const splitStatements = (source: string): string[] => {
  const statements: string[] = [];
  let current = "";
  let quoted = false;
  let depth = 0;

  const flush = () => {
    const statement = current.trim();
    if (statement) statements.push(statement);
    current = "";
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      current += char;
      if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      current += char;
      continue;
    }
    if (char === "%" && source[i + 1] === "%" && depth === 0) {
      while (i < source.length && source[i] !== "\n") i++;
      flush();
      continue;
    }
    if (char === "[" || char === "(" || char === "{") depth++;
    else if (char === "]" || char === ")" || char === "}")
      depth = Math.max(0, depth - 1);

    if ((char === "\n" || char === ";") && depth === 0) {
      flush();
      continue;
    }
    current += char;
  }
  flush();
  return statements;
};

const normalizeDirection = (raw: string): GraphDirection => {
  const upper = raw.toUpperCase();
  // Mermaid's TD and TB are the same ranking; graphre only knows TB.
  return upper === "TD" ? "TB" : (upper as GraphDirection);
};
