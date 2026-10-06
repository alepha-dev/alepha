import { parseTypedReference } from "./typedReference.ts";

/**
 * Minimal attachment shape needed to resolve an `assets/<name>` reference.
 * Pulled from `FolioAttachmentController.listAttachments` or `currentFolioAttachmentsAtom`.
 */
export interface AttachmentRef {
  /**
   * UUID — both PK and file id served at `/api/files/<uuid>`.
   */
  fileId: string;
  shortId: number;
  /**
   * Display name in the Attachments tab (e.g. `diagram.png`).
   */
  name: string;
  /**
   * MIME type from the framework `files` row. Drives image vs file render.
   */
  mime?: string;
  /**
   * Byte size from the framework `files` row. Shown next to non-image links.
   */
  size?: number;
}

/**
 * One referenceable row, as much of it as a link needs: the per-project
 * number the token names (`#Q12`, `#E3`, `#F12`, `#P120`, `#R7`) and its
 * title. A kind that addresses its page by something else carries it too:
 * a release's `tag`.
 *
 * The rows come from the module that owns the kind, registered on core's
 * `ElementReferenceRegistry` (#E75, #Q2624): core resolves `[[...]]`
 * without knowing what a quest or a folio is.
 */
export interface ElementReference {
  number: number;
  title: string;
  tag?: string;
  status?: string;
}

/**
 * What the resolver needs from a reference kind: its name, as
 * `typedReference.ts` parses it, and the page a row of it lives at.
 */
export interface ElementReferenceLinks {
  kind: string;
  href: (projectSlug: string, ref: ElementReference) => string;
}

/**
 * Why a token resolved to nothing.
 *
 * - `not-a-reference`: a `[[...]]` that is not `#<LETTER><integer>`: a
 *   title, a path, a `quest:` prefix, an anchor, the forms epic #32 purged.
 *   Rendered as a broken link and never as prose, because a visible break
 *   beats a silent one, and the hover card says what to write instead.
 * - `attachment-not-found`: an `assets/<name>` reference naming no
 *   attachment of the folio.
 * - `<kind>-not-found`: a well-formed token whose kind holds no such
 *   number, or whose kind no module registered.
 */
export type BrokenWikiLinkReason =
  | "not-a-reference"
  | "attachment-not-found"
  | `${string}-not-found`;

/**
 * Synthetic href for a reference that resolved to nothing. It is not a URL
 * anybody navigates to - the reader-side hover card and the editor's own
 * click handler both recognise the prefix and explain the failure instead of
 * following it (#107).
 *
 * ⚠️ The leading `#` is load-bearing, and this used to be a bare
 * `lore-broken:` scheme. react-markdown runs every href through
 * `defaultUrlTransform`, which drops any scheme outside its safe list - so
 * every broken link reached the DOM as `href=""` and NONE of the machinery
 * downstream of it ever ran: not the wavy red underline keyed on the prefix,
 * not the hover card explaining the reason, not the localised messages in
 * both catalogues. A fragment is a relative URL, so the transform keeps it
 * verbatim, colons and all. Anything that replaces this must survive that
 * transform; a custom scheme cannot without a change to `MarkdownView`.
 */
export const BROKEN_HREF_PREFIX = "#lore-broken:";

/**
 * What one `[[...]]` token points at.
 *
 * `href` is always populated, including for `broken` — carrying the reason
 * in the href is what lets a rewritten markdown document keep the diagnosis
 * through a renderer that only understands links.
 */
export type WikiLinkTarget =
  | { kind: string; href: string; label: string }
  | {
      kind: "broken";
      href: string;
      label: string;
      reason: BrokenWikiLinkReason;
    };

export interface WikiLinkResolverInput {
  projectSlug: string;
  /**
   * Every registered kind. A token of a kind missing here resolves to
   * `<kind>-not-found`, the same outcome as a real miss.
   */
  kinds: readonly ElementReferenceLinks[];
  /**
   * The rows each kind holds, keyed by kind. Absent means every token of
   * that kind is `<kind>-not-found`.
   */
  refs: Record<string, ElementReference[]>;
  /**
   * The folio's attachments, for `assets/<name>` references. Absent means
   * every one of them is `attachment-not-found`.
   */
  attachments?: AttachmentRef[];
}

export interface WikiLinkResolver {
  /**
   * Resolve the INNER text of a token — `"#Q7"`, `"#F42"` — without the
   * surrounding brackets. Returns `undefined` only for a token that is
   * entirely blank, which is not a reference at all and should be left
   * exactly as the author typed it.
   */
  resolve: (body: string) => WikiLinkTarget | undefined;
  /**
   * Resolve the `<name>` half of an `assets/<name>` path to its row.
   *
   * This is the form folio markdown actually stores, and the reason it is by
   * name rather than by id: the stored document is also the EXPORTED
   * document, so `assets/photo.webp` has to mean something once unzipped
   * next to an `assets/` folder, with no Lore to resolve it.
   */
  resolveAttachmentByName: (name: string) => AttachmentRef | undefined;
}

/**
 * File extensions that render inline as `<img>` when embedded.
 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "avif",
]);

export const isImageAttachment = (attachment: AttachmentRef): boolean => {
  if (attachment.mime?.startsWith("image/")) return true;
  const ext = attachment.name.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
};

export const formatAttachmentBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Build a reusable resolver over one project's referenceable rows, of every
 * kind a module registered, and one folio's attachments.
 *
 * The lookup maps are built once per resolver, not once per token: a folio
 * body with fifty references would otherwise rebuild them fifty times, and
 * the editor resolves a token on every keystroke inside it.
 *
 * The rules mirror the server-side `ResourceLinkService` exactly, because what
 * the reader sees resolved and what gets persisted in `folio_links` have to
 * agree — a resolver that drifted from the server would show a live link for
 * an edge the graph does not have (or the reverse).
 *
 * One grammar (epic #32): `[[#Q12]]` / `[[#E3]]` / `[[#F42]]` / `[[#P120]]`
 * / `[[#R12]]`. The letter names the kind, case-insensitive, and the number
 * is its per-project id, read through `typedReference.ts`, the module the
 * server parser reads it through. Where a row links to is its kind's own
 * `href`: `#P120` links to the inbox naming the item, since feedback has no
 * page of its own; `#R12` resolves the number and navigates by the
 * release's tag. Anything else between the brackets is
 * `not-a-reference`: the title, path, `quest:` and anchor forms were purged
 * with the machinery that resolved them.
 */
export const createWikiLinkResolver = (
  input: WikiLinkResolverInput,
): WikiLinkResolver => {
  const { projectSlug } = input;
  const attachments = input.attachments ?? [];

  const byKind = new Map<
    string,
    { links: ElementReferenceLinks; rows: Map<number, ElementReference> }
  >();
  for (const links of input.kinds) {
    const rows = new Map<number, ElementReference>();
    for (const ref of input.refs[links.kind] ?? []) rows.set(ref.number, ref);
    byKind.set(links.kind, { links, rows });
  }

  // Built on first use: a body with no `assets/` path never pays for it.
  let attachmentByName: Map<string, AttachmentRef> | undefined;
  const resolveAttachmentByName = (name: string): AttachmentRef | undefined => {
    attachmentByName ??= new Map(
      attachments.map((attachment) => [
        attachment.name.trim().toLowerCase(),
        attachment,
      ]),
    );
    return attachmentByName.get(name.trim().toLowerCase());
  };

  const brokenTarget = (
    body: string,
    reason: BrokenWikiLinkReason,
  ): WikiLinkTarget => ({
    kind: "broken",
    href: `${BROKEN_HREF_PREFIX}${reason}`,
    label: `[[${body}]]`,
    reason,
  });

  const resolve = (body: string): WikiLinkTarget | undefined => {
    const trimmed = body.trim();
    if (!trimmed) return undefined;

    const typed = parseTypedReference(trimmed);
    if (!typed) return brokenTarget(body, "not-a-reference");

    // The letter decides the kind, and only that kind is searched: resolving
    // across kinds would make a link's target depend on which tables happen
    // to hold the number.
    const entry = byKind.get(typed.kind);
    const ref = entry?.rows.get(typed.id);
    if (!entry || !ref) return brokenTarget(body, `${typed.kind}-not-found`);
    return {
      kind: typed.kind,
      href: entry.links.href(projectSlug, ref),
      label: ref.title,
    };
  };

  return { resolve, resolveAttachmentByName };
};
