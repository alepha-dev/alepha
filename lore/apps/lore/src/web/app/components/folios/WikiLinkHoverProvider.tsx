import { useClient } from "alepha/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { type BlobRef, BROKEN_HREF_PREFIX } from "./rewriteFolioWikiLinks.ts";

/**
 * Obsidian-style hover-card preview on `[[wiki-links]]` in folio /
 * quest markdown bodies. Wraps `MarkdownView` and uses pointer-event
 * delegation on `<a>` elements — `MarkdownView` lives in `@alepha/ui`
 * and we can't fork it, so we identify wiki-links by their URL shape:
 *
 * - `/c/<campaignId>/archive/<shortId>` → folio preview
 * - `/c/<campaignId>/q/<shortId>` → quest preview
 * - `/api/files/<uuid>` → blob preview (the rewriter only emits this
 *   URL for resolved blob refs, so the false-positive risk on a
 *   user-typed link is negligible)
 *
 * Preview data is fetched on first hover and cached per session.
 * Blob metadata comes from the precomputed list the rewriter already
 * built (no extra fetch).
 */
export interface WikiLinkHoverProviderProps {
  campaignId: number;
  blobs: BlobRef[];
  children: React.ReactNode;
}

export type BrokenReason =
  | "folio-not-found"
  | "ambiguous-title"
  | "quest-not-found"
  | "blob-not-found";

type HoverTarget =
  | { kind: "folio"; shortId: number }
  | { kind: "quest"; shortId: number }
  | { kind: "blob"; fileId: string }
  | { kind: "broken"; reason: BrokenReason };

interface HoverState {
  target: HoverTarget;
  anchorEl: HTMLAnchorElement;
}

const FOLIO_RE = /^\/c\/(\d+)\/archive\/(\d+)(?:[#?]|$)/;
const QUEST_RE = /^\/c\/(\d+)\/q\/(\d+)(?:[#?]|$)/;
const BLOB_RE = /^\/api\/files\/([a-f0-9-]{36})(?:[#?]|$)/i;

const parseHref = (
  href: string | null,
  campaignId: number,
): HoverTarget | null => {
  if (!href) return null;
  if (href.startsWith(BROKEN_HREF_PREFIX)) {
    const reason = href.slice(BROKEN_HREF_PREFIX.length) as BrokenReason;
    return { kind: "broken", reason };
  }
  // Strip protocol/host if present (markdown links are typically root-relative
  // but a user could paste an absolute URL into a wiki body).
  const path = href.startsWith("http")
    ? new URL(href).pathname + new URL(href).search + new URL(href).hash
    : href;
  const folio = FOLIO_RE.exec(path);
  if (folio && Number(folio[1]) === campaignId) {
    return { kind: "folio", shortId: Number(folio[2]) };
  }
  const quest = QUEST_RE.exec(path);
  if (quest && Number(quest[1]) === campaignId) {
    return { kind: "quest", shortId: Number(quest[2]) };
  }
  const blob = BLOB_RE.exec(path);
  if (blob) return { kind: "blob", fileId: blob[1] };
  return null;
};

const targetKey = (t: HoverTarget): string => {
  if (t.kind === "blob") return `blob:${t.fileId}`;
  if (t.kind === "broken") return `broken:${t.reason}`;
  return `${t.kind}:${t.shortId}`;
};

const BROKEN_REASON_TEXT: Record<BrokenReason, string> = {
  "folio-not-found": "No folio matches this reference.",
  "ambiguous-title":
    "Several entries share this title — use the explicit `#N` form to disambiguate.",
  "quest-not-found": "No quest matches this reference.",
  "blob-not-found": "No archive blob matches this reference.",
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
  const { campaignId, blobs } = props;
  const folioApi = useClient<FolioController>();
  const questApi = useClient<QuestController>();

  const [hover, setHover] = useState<HoverState | null>(null);
  const cache = useRef(
    new Map<string, FolioPreview | QuestPreview | BlobPreview>(),
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const anchor = el?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      const t = parseHref(href, campaignId);
      if (!t) return;
      cancelClose();
      setHover((prev) =>
        prev && prev.anchorEl === anchor
          ? prev
          : { target: t, anchorEl: anchor },
      );
    },
    [campaignId, cancelClose],
  );

  const handleLeave = useCallback(
    (current: Node, related: Node | null) => {
      if (related && current.contains(related)) return;
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
      onMouseOut={(e) =>
        handleLeave(e.currentTarget, e.relatedTarget as Node | null)
      }
      onBlur={(e) =>
        handleLeave(e.currentTarget, e.relatedTarget as Node | null)
      }
      onClick={handleClick}
    >
      {props.children}
      {hover && (
        <HoverCardPopover
          key={targetKey(hover.target)}
          state={hover}
          campaignId={campaignId}
          blobByUuid={blobByUuid}
          cache={cache.current}
          folioApi={folioApi}
          questApi={questApi}
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
  tags: string[];
}
interface QuestPreview {
  kind: "quest";
  title: string;
  zone?: string;
  priority?: string;
  status?: string;
  shortId: number;
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
  campaignId: number;
  blobByUuid: Map<string, BlobRef>;
  cache: Map<string, FolioPreview | QuestPreview | BlobPreview>;
  folioApi: ReturnType<typeof useClient<FolioController>>;
  questApi: ReturnType<typeof useClient<QuestController>>;
  onEnter: () => void;
  onLeave: () => void;
}

const HoverCardPopover = (props: HoverCardPopoverProps) => {
  const { state, campaignId, blobByUuid, cache, folioApi, questApi } = props;
  const key = targetKey(state.target);
  const [data, setData] = useState<
    FolioPreview | QuestPreview | BlobPreview | null
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
            params: { campaignId, shortId: state.target.shortId },
          })) as Folio;
          const body = stripMarkdown(folio.content ?? "");
          const preview: FolioPreview = {
            kind: "folio",
            title: folio.title,
            summary: folio.summary || undefined,
            bodyPreview: body.split("\n").slice(0, 10).join("\n").slice(0, 600),
            tags: folio.tags ?? [],
          };
          cache.set(key, preview);
          if (alive) setData(preview);
        } else if (state.target.kind === "quest") {
          const quest = (await questApi.getQuestByShortId({
            params: { campaignId, shortId: state.target.shortId },
          })) as QuestResource;
          const preview: QuestPreview = {
            kind: "quest",
            title: quest.title,
            zone: quest.zone,
            priority: quest.priority,
            status: quest.metadata.status,
            shortId: quest.shortId,
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
  }, [key, state.target, campaignId, blobByUuid, cache, folioApi, questApi]);

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
      style={{ position: "fixed", top, left, zIndex: 50 }}
      className="bg-popover text-popover-foreground border-border w-[360px] max-w-[90vw] rounded-md border p-3 shadow-lg"
      onMouseEnter={props.onEnter}
      onMouseLeave={props.onLeave}
    >
      {state.target.kind === "broken" ? (
        <div className="flex flex-col gap-1">
          <span className="text-destructive flex items-center gap-1.5 text-sm font-semibold">
            <span aria-hidden>⚠</span>
            Broken link
          </span>
          <span className="text-muted-foreground text-xs">
            {BROKEN_REASON_TEXT[state.target.reason]}
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
          {data.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {data.tags.slice(0, 6).map((t) => (
                <span
                  key={t}
                  className="bg-muted rounded-sm border px-1.5 py-0.5 font-mono text-[10px]"
                >
                  {t}
                </span>
              ))}
            </div>
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
            {data.zone && <span>{data.zone}</span>}
            {data.priority && <span>· {data.priority}</span>}
            {data.status && <span>· {data.status}</span>}
          </div>
        </div>
      )}
      {data?.kind === "blob" && (
        <div className="flex flex-col gap-1.5">
          {data.mime?.startsWith("image/") && (
            <img
              alt={data.name}
              src={`/api/files/${data.fileId}`}
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
