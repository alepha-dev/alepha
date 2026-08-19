import { FileImage } from "@alepha/ui/components/file-image/file-image";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "../../services/I18n.ts";
import type { BrokenWikiLinkReason } from "./folioWikiLinkResolver.ts";
import { type BlobRef, BROKEN_HREF_PREFIX } from "./rewriteFolioWikiLinks.ts";

/**
 * Obsidian-style hover-card preview on `[[wiki-links]]` in folio /
 * quest markdown bodies. Wraps `MarkdownView` and uses pointer-event
 * delegation on `<a>` elements — `MarkdownView` lives in `@alepha/ui`
 * and we can't fork it, so we identify wiki-links by their URL shape:
 *
 * - `/<projectSlug>/folios/<shortId>` → folio preview
 * - `/<projectSlug>/quests/<shortId>` → quest preview
 * - `/<projectSlug>/epics/<number>` → epic preview
 * - `/api/files/<uuid>` → blob preview (the rewriter only emits this
 *   URL for resolved blob refs, so the false-positive risk on a
 *   user-typed link is negligible)
 *
 * Preview data is fetched on first hover and cached per session.
 * Blob metadata comes from the precomputed list the rewriter already
 * built (no extra fetch).
 */
export interface WikiLinkHoverProviderProps {
  /** Addresses the preview fetches, which are API calls. */
  projectId: number;
  /** Matched against the first segment of a hovered link's own URL. */
  projectSlug: string;
  blobs: BlobRef[];
  children: React.ReactNode;
}

/**
 * Re-exported from the resolver rather than restated.
 *
 * It used to be a second, hand-kept copy of the same union — which meant
 * adding a reason on the resolver side was not a type error here, it just left
 * `BROKEN_REASON_TEXT` without an entry and rendered `undefined` into the
 * card. Aliasing makes the `Record` below exhaustive, so the next reason
 * cannot be added without its explanation.
 */
export type BrokenReason = BrokenWikiLinkReason;

type HoverTarget =
  | { kind: "folio"; shortId: number }
  | { kind: "quest"; shortId: number }
  // `shortId` on an epic is its per-project `number` — one field name
  // across the union so `targetKey` and the fetch switch stay uniform.
  | { kind: "epic"; shortId: number }
  | { kind: "blob"; fileId: string }
  | { kind: "broken"; reason: BrokenReason; hint?: string };

interface HoverState {
  target: HoverTarget;
  /** The `<a href>` (reader) or `[data-wiki-href]` span (editor) hovered. */
  anchorEl: HTMLElement;
}

// The project segment is the slug, so it is matched as an opaque segment and
// compared against the open project's own — an id could be matched as `\d+`,
// a slug cannot be told from any other first segment by shape alone.
const FOLIO_RE = /^\/([^/]+)\/folios\/(\d+)(?:[#?]|$)/;
const QUEST_RE = /^\/([^/]+)\/quests\/(\d+)(?:[#?]|$)/;
const EPIC_RE = /^\/([^/]+)\/epics\/(\d+)(?:[#?]|$)/;
const BLOB_RE = /^\/api\/files\/([a-f0-9-]{36})(?:[#?]|$)/i;

const parseHref = (
  href: string | null,
  projectSlug: string,
): HoverTarget | null => {
  if (!href) return null;
  if (href.startsWith(BROKEN_HREF_PREFIX)) {
    // `reason[:hint]` — no reason contains a colon, so the first one splits.
    const rest = href.slice(BROKEN_HREF_PREFIX.length);
    const sep = rest.indexOf(":");
    return sep === -1
      ? { kind: "broken", reason: rest as BrokenReason }
      : {
          kind: "broken",
          reason: rest.slice(0, sep) as BrokenReason,
          hint: rest.slice(sep + 1),
        };
  }
  // Strip protocol/host if present (markdown links are typically root-relative
  // but a user could paste an absolute URL into a wiki body).
  const path = href.startsWith("http")
    ? new URL(href).pathname + new URL(href).search + new URL(href).hash
    : href;
  const folio = FOLIO_RE.exec(path);
  if (folio && folio[1] === projectSlug) {
    return { kind: "folio", shortId: Number(folio[2]) };
  }
  const epic = EPIC_RE.exec(path);
  if (epic && epic[1] === projectSlug) {
    return { kind: "epic", shortId: Number(epic[2]) };
  }
  const quest = QUEST_RE.exec(path);
  if (quest && quest[1] === projectSlug) {
    return { kind: "quest", shortId: Number(quest[2]) };
  }
  const blob = BLOB_RE.exec(path);
  if (blob) return { kind: "blob", fileId: blob[1] };
  return null;
};

const targetKey = (t: HoverTarget): string => {
  if (t.kind === "blob") return `blob:${t.fileId}`;
  if (t.kind === "broken") return `broken:${t.reason}:${t.hint ?? ""}`;
  return `${t.kind}:${t.shortId}`;
};

const BROKEN_REASON_KEY: Record<BrokenReason, string> = {
  "folio-not-found": "folios.wikilink.broken.folioNotFound",
  "ambiguous-title": "folios.wikilink.broken.ambiguous",
  "quest-not-found": "folios.wikilink.broken.questNotFound",
  "epic-not-found": "folios.wikilink.broken.epicNotFound",
  "blob-not-found": "folios.wikilink.broken.blobNotFound",
  "folio-not-found-quest-exists": "folios.wikilink.broken.questFormWanted",
};

const formatBytes = (bytes: number | undefined): string => {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const stripMarkdown = (raw: string): string =>
  raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~]/g, "")
    .trim();

const WikiLinkHoverProvider = (props: WikiLinkHoverProviderProps) => {
  const { projectId, projectSlug, blobs } = props;
  const folioApi = useClient<FolioController>();
  const questApi = useClient<QuestController>();
  const epicApi = useClient<EpicController>();

  const [hover, setHover] = useState<HoverState | null>(null);
  const cache = useRef(
    new Map<string, FolioPreview | QuestPreview | EpicPreview | BlobPreview>(),
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // `handleLeave` must read the CURRENT anchor, not the one captured when the
  // callback was created: moving straight from one wiki-link to another swaps
  // `hover` before the next leave fires, and a stale closure would then test
  // the departure against the previous anchor.
  const hoverRef = useRef<HoverState | null>(null);
  hoverRef.current = hover;

  const blobByUuid = useMemo(() => {
    const m = new Map<string, BlobRef>();
    for (const b of blobs) m.set(b.fileId, b);
    return m;
  }, [blobs]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    // Small grace window so the user can move from the link into the
    // popover without it vanishing mid-transit.
    closeTimer.current = setTimeout(() => setHover(null), 120);
  }, [cancelClose]);

  const handleEnter = useCallback(
    (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      // Two markups, one preview. The reader side renders a rewritten
      // markdown link, so the target is on `href`; the editor decorates the
      // token in place and puts it on `data-wiki-href`, because an `<a>`
      // inside a `contenteditable` brings its own drag and selection
      // behaviour along with it (see `WikiLinkNode`).
      const anchor = el?.closest(
        "a[href], [data-wiki-href]",
      ) as HTMLElement | null;
      if (!anchor) return;
      const href =
        anchor.getAttribute("data-wiki-href") ?? anchor.getAttribute("href");
      const t = parseHref(href, projectSlug);
      if (!t) return;
      cancelClose();
      setHover((prev) =>
        prev && prev.anchorEl === anchor
          ? prev
          : { target: t, anchorEl: anchor },
      );
    },
    [projectId, cancelClose],
  );

  /**
   * Close as soon as the pointer leaves the hovered LINK — not the pane.
   *
   * Both handlers are delegated on the wrapper, so the obvious `e.currentTarget`
   * is the whole document pane; testing containment against it meant
   * "anywhere else in this folio" counted as still-hovering, and the card only
   * ever closed by leaving the pane entirely.
   *
   * The card itself stays exempt — that is what makes the preview hoverable —
   * as does the anchor's own subtree, so moving onto a `<strong>` inside the
   * link is not a departure. The 120 ms `scheduleClose` grace covers the gap
   * between the link and the card.
   */
  const handleLeave = useCallback(
    (related: Node | null) => {
      const current = hoverRef.current;
      if (!current) return;
      if (related) {
        if (current.anchorEl.contains(related)) return;
        if (cardRef.current?.contains(related)) return;
      }
      scheduleClose();
    },
    [scheduleClose],
  );

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const anchor = el.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    if (anchor.getAttribute("href")?.startsWith(BROKEN_HREF_PREFIX)) {
      e.preventDefault();
    }
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: event delegation over rendered MarkdownView anchors; keyboard a11y handled by the underlying anchors.
    <div
      className="relative [&_a[href^='lore-broken:']]:text-destructive [&_a[href^='lore-broken:']]:decoration-destructive/40 [&_a[href^='lore-broken:']]:decoration-wavy [&_a[href^='lore-broken:']]:cursor-help"
      onMouseOver={(e) => handleEnter(e.target)}
      onFocus={(e) => handleEnter(e.target)}
      onMouseOut={(e) => handleLeave(e.relatedTarget as Node | null)}
      onBlur={(e) => handleLeave(e.relatedTarget as Node | null)}
      onClick={handleClick}
    >
      {props.children}
      {hover && (
        <HoverCardPopover
          key={targetKey(hover.target)}
          state={hover}
          projectId={projectId}
          blobByUuid={blobByUuid}
          cache={cache.current}
          folioApi={folioApi}
          questApi={questApi}
          epicApi={epicApi}
          cardRef={cardRef}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

interface FolioPreview {
  kind: "folio";
  title: string;
  summary?: string;
  bodyPreview: string;
}
interface QuestPreview {
  kind: "quest";
  title: string;
  area?: string;
  priority?: string;
  status?: string;
  shortId: number;
}
interface EpicPreview {
  kind: "epic";
  title: string;
  /** The epic's per-project `number`, which is how it is addressed. */
  number: number;
  status: string;
  /** `completed / total` quests, the same rollup the Epics list shows. */
  progress: { completed: number; total: number };
}

interface BlobPreview {
  kind: "blob";
  name: string;
  size?: number;
  mime?: string;
  fileId: string;
}

interface HoverCardPopoverProps {
  state: HoverState;
  projectId: number;
  blobByUuid: Map<string, BlobRef>;
  cache: Map<string, FolioPreview | QuestPreview | EpicPreview | BlobPreview>;
  folioApi: ReturnType<typeof useClient<FolioController>>;
  questApi: ReturnType<typeof useClient<QuestController>>;
  epicApi: ReturnType<typeof useClient<EpicController>>;
  /**
   * Handed up so the delegated leave check can exempt the card: it is rendered
   * inside the pane but positioned `fixed` over it, and crossing into it must
   * not read as leaving the link.
   */
  cardRef: RefObject<HTMLDivElement | null>;
  onEnter: () => void;
  onLeave: () => void;
}

const HoverCardPopover = (props: HoverCardPopoverProps) => {
  const { state, projectId, blobByUuid, cache, folioApi, questApi, epicApi } =
    props;
  const { tr } = useI18n<I18n, "en">();
  const key = targetKey(state.target);
  const [data, setData] = useState<
    FolioPreview | QuestPreview | EpicPreview | BlobPreview | null
  >(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(!cache.has(key));

  useEffect(() => {
    if (cache.has(key)) {
      setData(cache.get(key) ?? null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        if (state.target.kind === "folio") {
          const folio = (await folioApi.getByShortId({
            params: { projectId, shortId: state.target.shortId },
          })) as Folio;
          const body = stripMarkdown(folio.content ?? "");
          const preview: FolioPreview = {
            kind: "folio",
            title: folio.title,
            summary: folio.summary || undefined,
            bodyPreview: body.split("\n").slice(0, 10).join("\n").slice(0, 600),
          };
          cache.set(key, preview);
          if (alive) setData(preview);
        } else if (state.target.kind === "quest") {
          const quest = (await questApi.getQuestByShortId({
            params: { projectId, shortId: state.target.shortId },
          })) as QuestResource;
          const preview: QuestPreview = {
            kind: "quest",
            title: quest.title,
            area: quest.area,
            priority: quest.priority,
            status: quest.metadata.status,
            shortId: quest.shortId,
          };
          cache.set(key, preview);
          if (alive) setData(preview);
        } else if (state.target.kind === "epic") {
          // `shortId` on an epic target IS its `number` — see `EpicRef`.
          const epic = await epicApi.getEpicByNumber({
            params: { projectId, number: state.target.shortId },
          });
          const preview: EpicPreview = {
            kind: "epic",
            title: epic.title,
            number: epic.number,
            status: epic.status,
            progress: {
              completed: epic.progress.completed,
              total: epic.progress.total,
            },
          };
          cache.set(key, preview);
          if (alive) setData(preview);
        } else if (state.target.kind === "blob") {
          const blob = blobByUuid.get(state.target.fileId);
          if (!blob) {
            if (alive) setData(null);
            return;
          }
          const preview: BlobPreview = {
            kind: "blob",
            name: blob.name,
            size: blob.size,
            mime: blob.mime,
            fileId: blob.fileId,
          };
          cache.set(key, preview);
          if (alive) setData(preview);
        } else {
          // Broken — nothing to fetch; the popover renders the reason
          // straight from `state.target.reason` below.
          if (alive) setData(null);
        }
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, state.target, projectId, blobByUuid, cache, folioApi, questApi]);

  // Position: anchor's bounding rect, popover below the link with a
  // small gap. Fixed positioning + viewport math so it stays put on
  // scroll until the hover ends.
  const rect = state.anchorEl.getBoundingClientRect();
  const top = rect.bottom + 8;
  const left = Math.max(
    8,
    Math.min(
      rect.left,
      (typeof window !== "undefined" ? window.innerWidth : 1000) - 380,
    ),
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: presentational popover that follows the anchor; no keyboard interaction expected.
    <div
      ref={props.cardRef}
      style={{ position: "fixed", top, left, zIndex: 50 }}
      className="bg-popover text-popover-foreground border-border w-[360px] max-w-[90vw] rounded-md border p-3 shadow-lg"
      onMouseEnter={props.onEnter}
      onMouseLeave={props.onLeave}
    >
      {state.target.kind === "broken" ? (
        <div className="flex flex-col gap-1">
          <span className="text-destructive flex items-center gap-1.5 text-sm font-semibold">
            <span aria-hidden>⚠</span>
            {tr("folios.wikilink.broken.title")}
          </span>
          <span className="text-muted-foreground text-xs">
            {tr(BROKEN_REASON_KEY[state.target.reason], {
              args: [state.target.hint ?? ""],
            })}
          </span>
        </div>
      ) : loading ? (
        <p className="text-muted-foreground text-xs">Loading…</p>
      ) : null}
      {state.target.kind !== "broken" && !loading && !data && (
        <p className="text-muted-foreground text-xs italic">
          Preview unavailable
        </p>
      )}
      {data?.kind === "folio" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">{data.title}</span>
          {data.summary && (
            <span className="text-muted-foreground text-xs italic">
              {data.summary}
            </span>
          )}
          {data.bodyPreview && (
            <pre className="text-muted-foreground max-h-32 overflow-hidden text-xs leading-relaxed whitespace-pre-wrap">
              {data.bodyPreview}
            </pre>
          )}
        </div>
      )}
      {data?.kind === "quest" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground font-mono text-xs">
              #{data.shortId}
            </span>
            <span className="text-sm font-semibold">{data.title}</span>
          </div>
          <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
            {data.area && <span>{data.area}</span>}
            {data.priority && <span>· {data.priority}</span>}
            {data.status && <span>· {data.status}</span>}
          </div>
        </div>
      )}
      {data?.kind === "epic" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground font-mono text-xs">
              #{data.number}
            </span>
            <span className="text-sm font-semibold">{data.title}</span>
          </div>
          <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
            <span>{data.status}</span>
            <span>
              · {data.progress.completed}/{data.progress.total}
            </span>
          </div>
        </div>
      )}
      {data?.kind === "blob" && (
        <div className="flex flex-col gap-1.5">
          {data.mime?.startsWith("image/") && (
            <FileImage
              id={data.fileId}
              alt={data.name}
              className="max-h-48 w-full rounded-sm border object-contain"
            />
          )}
          <span className="text-sm font-semibold break-all">{data.name}</span>
          <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
            {data.size != null && <span>{formatBytes(data.size)}</span>}
            {data.mime && <span>· {data.mime}</span>}
          </div>
        </div>
      )}
    </div>
  );
};

export default WikiLinkHoverProvider;
