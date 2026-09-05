import type { Folio } from "@/api/entities/folios.ts";

import { parseTypedReference } from "../shared/element/typedReference.ts";

/**
 * Minimal attachment shape needed to resolve an `assets/<name>` reference.
 * Pulled from `BlobController.listBlobs` or `currentFolioBlobsAtom`.
 */
export interface BlobRef {
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

export interface QuestRef {
  shortId: number;
  title: string;
}

/**
 * An epic, keyed by the per-project `number` it is addressed by. Named
 * `shortId` to match {@link QuestRef} so one map-building shape serves both
 * — epics have no `shortId` column of their own.
 */
export interface EpicRef {
  shortId: number;
  title: string;
}

/**
 * A feedback item, addressed as `#P120` by its `shortId`. Served by
 * `FeedbackController.listFeedbackRefs`, three columns for the whole inbox.
 */
export interface FeedbackRef {
  shortId: number;
  title: string;
  status?: string;
}

/**
 * A release, addressed as `#R12` by its `number`. The tag is what the
 * release page is reached by, and a release may have none.
 */
export interface ReleaseRef {
  number: number;
  title: string;
  tag?: string;
}

export type BrokenWikiLinkReason =
  /**
   * A `[[...]]` that is not `#<LETTER><integer>`: a title, a path, a
   * `quest:` prefix, an anchor, the forms epic #32 purged. Rendered as a
   * broken link and never as prose, because a visible break beats a silent
   * one, and the hover card says what to write instead.
   */
  | "not-a-reference"
  | "folio-not-found"
  | "quest-not-found"
  | "epic-not-found"
  /**
   * An `assets/<name>` reference naming no attachment of the folio.
   */
  | "blob-not-found"
  | "feedback-not-found"
  | "release-not-found";

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
  | { kind: "folio"; href: string; label: string }
  | { kind: "quest"; href: string; label: string }
  | { kind: "epic"; href: string; label: string }
  | { kind: "feedback"; href: string; label: string }
  | { kind: "release"; href: string; label: string }
  | {
      kind: "broken";
      href: string;
      label: string;
      reason: BrokenWikiLinkReason;
    };

export interface FolioWikiLinkResolverInput {
  projectSlug: string;
  folios: Folio[];
  quests: QuestRef[];
  /**
   * Optional so a caller that never renders epic refs keeps working — an
   * `[[#E3]]` then resolves to `epic-not-found` rather than throwing, which
   * is the same outcome as a real miss.
   */
  epics?: EpicRef[];
  /**
   * The folio's attachments, for `assets/<name>` references. Absent means
   * every one of them is `blob-not-found`.
   */
  blobs?: BlobRef[];
  /**
   * Same rule as `epics`: absent means every `#P` resolves to
   * `feedback-not-found`, and every `#R` to `release-not-found`.
   */
  feedback?: FeedbackRef[];
  releases?: ReleaseRef[];
}

export interface FolioWikiLinkResolver {
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
  resolveBlobByName: (name: string) => BlobRef | undefined;
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

export const isImageBlob = (blob: BlobRef): boolean => {
  if (blob.mime?.startsWith("image/")) return true;
  const ext = blob.name.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
};

export const formatBlobBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Build a reusable resolver over one project's folios, quests, epics,
 * feedback and releases, and one folio's attachments.
 *
 * The lookup maps are built once per resolver, not once per token: a folio
 * body with fifty references would otherwise rebuild them fifty times, and
 * the editor resolves a token on every keystroke inside it.
 *
 * The rules mirror the server-side `FolioLinkService` exactly, because what
 * the reader sees resolved and what gets persisted in `folio_links` have to
 * agree — a resolver that drifted from the server would show a live link for
 * an edge the graph does not have (or the reverse).
 *
 * One grammar (epic #32): `[[#Q12]]` / `[[#E3]]` / `[[#F42]]` / `[[#P120]]`
 * / `[[#R12]]`. The letter names the kind, case-insensitive, and the number
 * is its per-project id, read through `typedReference.ts`, the module the
 * server parser reads it through. `#P120` links to the inbox naming the
 * item, since feedback has no page of its own; `#R12` resolves the number
 * and navigates by the release's tag. Anything else between the brackets is
 * `not-a-reference`: the title, path, `quest:` and anchor forms were purged
 * with the machinery that resolved them.
 */
export const createFolioWikiLinkResolver = (
  input: FolioWikiLinkResolverInput,
): FolioWikiLinkResolver => {
  const { projectSlug, folios, quests } = input;
  const blobs = input.blobs ?? [];

  const folioByShort = new Map<number, Folio>();
  for (const f of folios) folioByShort.set(f.shortId, f);
  const questByShort = new Map<number, QuestRef>();
  for (const q of quests) questByShort.set(q.shortId, q);
  const epicByNumber = new Map<number, EpicRef>();
  for (const e of input.epics ?? []) epicByNumber.set(e.shortId, e);
  const feedbackByShort = new Map<number, FeedbackRef>();
  for (const f of input.feedback ?? []) feedbackByShort.set(f.shortId, f);
  const releaseByNumber = new Map<number, ReleaseRef>();
  for (const r of input.releases ?? []) releaseByNumber.set(r.number, r);

  /**
   * Built lazily and only for `assets/` references, so a document with none
   * never pays for it. Case-insensitive because `FolioBlobService` enforces
   * uniqueness case-insensitively too — `Photo.webp` and `photo.webp` cannot
   * both exist on one folio, so folding the key cannot introduce ambiguity.
   */
  let blobByName: Map<string, BlobRef> | undefined;
  const resolveBlobByName = (name: string): BlobRef | undefined => {
    blobByName ??= new Map(
      blobs.map((blob) => [blob.name.trim().toLowerCase(), blob]),
    );
    return blobByName.get(name.trim().toLowerCase());
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

    switch (typed.kind) {
      case "feedback": {
        const item = feedbackByShort.get(typed.id);
        if (!item) return brokenTarget(body, "feedback-not-found");
        return {
          kind: "feedback",
          // Feedback has no page of its own, so the inbox is the closest
          // surface. The query names the item, which is what the hover card
          // reads to preview it (and what a later inbox can open on).
          href: `/${projectSlug}/feedback?feedback=${item.shortId}`,
          label: item.title,
        };
      }
      case "release": {
        const release = releaseByNumber.get(typed.id);
        if (!release) return brokenTarget(body, "release-not-found");
        return {
          kind: "release",
          // Addressed by number, navigated by tag: `/releases/:releaseTag` is
          // the route. A release with no tag still resolves and shows its
          // title, and links to the list, since no URL names it.
          href: release.tag
            ? `/${projectSlug}/releases/${encodeURIComponent(release.tag)}`
            : `/${projectSlug}/releases`,
          label: release.title,
        };
      }
      case "quest": {
        const quest = questByShort.get(typed.id);
        if (!quest) return brokenTarget(body, "quest-not-found");
        return {
          kind: "quest",
          href: `/${projectSlug}/quests/${quest.shortId}`,
          label: quest.title,
        };
      }
      case "epic": {
        const epic = epicByNumber.get(typed.id);
        if (!epic) return brokenTarget(body, "epic-not-found");
        return {
          kind: "epic",
          // `shortId` here IS the epic's `number` — see `EpicRef`.
          href: `/${projectSlug}/epics/${epic.shortId}`,
          label: epic.title,
        };
      }
      case "folio": {
        const folio = folioByShort.get(typed.id);
        if (!folio) return brokenTarget(body, "folio-not-found");
        // Folio detail lives under `/folios/:shortId` — keep this in sync
        // with AppRouter.
        return {
          kind: "folio",
          href: `/${projectSlug}/folios/${folio.shortId}`,
          label: folio.title,
        };
      }
    }
  };

  return { resolve, resolveBlobByName };
};
