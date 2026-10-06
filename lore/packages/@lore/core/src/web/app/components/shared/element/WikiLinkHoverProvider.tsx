import { FileImage, formatBytes } from "@alepha/ui";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ElementReferenceRegistry,
  type ElementReferenceKind,
} from "../../../registries/ElementReferenceRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";
import { useHoverCardPosition } from "./useHoverCardPosition.ts";
import WikiLinkPreviewState from "./WikiLinkPreviewState.tsx";
import {
  type AttachmentRef,
  BROKEN_HREF_PREFIX,
  type BrokenWikiLinkReason,
} from "./wikiLinkResolver.ts";

/**
 * Obsidian-style hover-card preview on `[[wiki-links]]` in folio /
 * quest markdown bodies. Wraps `MarkdownView` and uses pointer-event
 * delegation on `<a>` elements — `MarkdownView` lives in `@alepha/ui`
 * and we can't fork it, so we identify wiki-links by their URL shape:
 *
 * - `/<projectSlug>/folios/<shortId>` → folio preview
 * - `/<projectSlug>/quests/<shortId>` → quest preview
 * - `/<projectSlug>/epics/<number>` → epic preview
 * - `/<projectSlug>/feedback?feedback=<shortId>` → feedback preview (the
 *   inbox is the only page feedback has; the query names the item)
 * - `/<projectSlug>/releases/<tag>` → release preview, read off the
 *   project's own release list rather than fetched
 * - `/api/files/<uuid>` → attachment preview (the rewriter only emits this
 *   URL for resolved attachment refs, so the false-positive risk on a
 *   user-typed link is negligible)
 *
 * Preview data is fetched on first hover and cached per session.
 * Blob metadata comes from the precomputed list the rewriter already
 * built (no extra fetch).
 */
export interface WikiLinkHoverProviderProps {
  /**
   * Addresses the preview fetches, which are API calls.
   */
  projectId: number;
  /**
   * Matched against the first segment of a hovered link's own URL.
   */
  projectSlug: string;
  attachments: AttachmentRef[];
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
  // A row of a registered kind, by whatever its `match` answered: a number,
  // or a release's tag, which is what its route takes.
  | { kind: "ref"; ref: ElementReferenceKind; id: string }
  | { kind: "attachment"; fileId: string }
  | { kind: "broken"; reason: BrokenReason };

interface HoverState {
  target: HoverTarget;
  /**
   * The `<a href>` hovered.
   */
  anchorEl: HTMLElement;
}

const ATTACHMENT_RE = /^\/api\/files\/([a-f0-9-]{36})(?:[#?]|$)/i;

/**
 * The path of a link target: an absolute URL is reduced to its path, a
 * malformed one ("httpfoo") is kept as is instead of throwing out of the
 * hover handler.
 */
const pathOf = (href: string): string => {
  if (!/^https?:\/\//i.test(href)) return href;
  try {
    const url = new URL(href);
    return url.pathname + url.search + url.hash;
  } catch {
    return href;
  }
};

const parseHref = (
  href: string | null,
  projectSlug: string,
  references: ElementReferenceRegistry,
): HoverTarget | null => {
  if (!href) return null;
  if (href.startsWith(BROKEN_HREF_PREFIX)) {
    return {
      kind: "broken",
      reason: href.slice(BROKEN_HREF_PREFIX.length) as BrokenReason,
    };
  }
  // Strip protocol/host if present (markdown links are typically root-relative
  // but a user could paste an absolute URL into a wiki body).
  const path = pathOf(href);
  // Each kind recognises its own pages, and only in this project: the
  // project segment is the slug, matched as an opaque segment and compared
  // against the open project's own.
  const ref = references.match(path, projectSlug);
  if (ref) return { kind: "ref", ref: ref.kind, id: ref.id };
  const attachment = ATTACHMENT_RE.exec(path);
  if (attachment) return { kind: "attachment", fileId: attachment[1] };
  return null;
};

const targetKey = (t: HoverTarget): string => {
  if (t.kind === "attachment") return `attachment:${t.fileId}`;
  if (t.kind === "broken") return `broken:${t.reason}`;
  return `${t.ref.kind}:${t.id}`;
};

/**
 * The i18n key explaining why a link is broken. A `<kind>-not-found` is
 * explained by its kind's own `brokenKey`; a kind no module registered reads
 * as not a reference at all, which is what it is in this build.
 */
const brokenReasonKey = (
  reason: BrokenReason,
  references: ElementReferenceRegistry,
): string => {
  if (reason === "attachment-not-found") {
    return "folios.wikilink.broken.attachmentNotFound";
  }
  const kind = reason.endsWith("-not-found")
    ? references.kinds().find((it) => `${it.kind}-not-found` === reason)
    : undefined;
  return kind?.brokenKey ?? "folios.wikilink.broken.notAReference";
};

/**
 * How long the pointer must rest on a wiki link before its preview opens.
 *
 * The card used to appear on the first `mouseover`, so reading a paragraph
 * with three links in it flashed three previews over the prose being read.
 * It also fetched each one - the inner component loads on mount, cached per
 * target - so an accidental sweep cost real requests.
 *
 * 400ms: past the ~200ms a pointer spends crossing a word in passing, and
 * short enough that a deliberate hover still feels answered. Deliberately
 * shorter than the 600ms house tooltip delay, because this card is asked
 * for by pointing at a specific link rather than offered on any control.
 */
const HOVER_OPEN_DELAY_MS = 400;

const WikiLinkHoverProvider = (props: WikiLinkHoverProviderProps) => {
  const { projectId, projectSlug, attachments } = props;
  const references = useInject(ElementReferenceRegistry);

  const [hover, setHover] = useState<HoverState | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The anchor an open is currently WAITING on, or null.
   *
   * Needed because a pending open has no `hover` state yet, so
   * `handleLeave` has nothing to test the departure against - and the
   * pointer leaving during the delay has to cancel the card, or it appears
   * over prose the pointer has already left.
   */
  const pendingAnchor = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // `handleLeave` must read the CURRENT anchor, not the one captured when the
  // callback was created: moving straight from one wiki-link to another swaps
  // `hover` before the next leave fires, and a stale closure would then test
  // the departure against the previous anchor.
  const hoverRef = useRef<HoverState | null>(null);
  hoverRef.current = hover;

  const attachmentByUuid = useMemo(() => {
    const m = new Map<string, AttachmentRef>();
    for (const b of attachments) m.set(b.fileId, b);
    return m;
  }, [attachments]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const cancelOpen = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    pendingAnchor.current = null;
  }, []);

  /**
   * Both timers, on unmount. Neither was cleared before: navigating away
   * mid-hover left a `setHover` scheduled against an unmounted tree.
   */
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      if (openTimer.current) clearTimeout(openTimer.current);
    },
    [],
  );

  const scheduleClose = useCallback(() => {
    cancelClose();
    // Small grace window so the user can move from the link into the
    // popover without it vanishing mid-transit.
    closeTimer.current = setTimeout(() => setHover(null), 120);
  }, [cancelClose]);

  /**
   * No grace window: the card's link has scrolled out of sight, and there is
   * nothing left for the pointer to be travelling towards.
   */
  const closeNow = useCallback(() => {
    cancelClose();
    setHover(null);
  }, [cancelClose]);

  const handleEnter = useCallback(
    (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      // One markup. `[data-wiki-href]` used to be the other: the Lexical
      // editor decorated the `[[token]]` in place rather than rendering an
      // `<a>`, because an anchor inside a `contenteditable` brings its own
      // drag and selection behaviour along with it. That editor is gone -
      // Edit mode is raw markdown in CodeMirror now, and View mode is the
      // rewritten markdown this delegates over - so nothing has emitted the
      // attribute for a long time.
      const anchor = el?.closest("a[href]") as HTMLElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      const t = parseHref(href, projectSlug, references);
      if (!t) return;
      cancelClose();

      // A card is already showing: move to this one immediately. Re-waiting
      // between adjacent links would read as the preview flickering off and
      // on while the pointer travels along a sentence, and the delay has
      // already done its job - the user has demonstrably stopped scanning.
      if (hoverRef.current) {
        cancelOpen();
        setHover((prev) =>
          prev && prev.anchorEl === anchor
            ? prev
            : { target: t, anchorEl: anchor },
        );
        return;
      }

      // `mouseover` bubbles from every child of the anchor, so this fires
      // repeatedly while the pointer moves inside one link. Without this
      // guard each of those restarts the timer and the card never opens at
      // all as long as the pointer keeps moving.
      if (pendingAnchor.current === anchor) return;

      cancelOpen();
      pendingAnchor.current = anchor;
      openTimer.current = setTimeout(() => {
        openTimer.current = null;
        pendingAnchor.current = null;
        setHover({ target: t, anchorEl: anchor });
      }, HOVER_OPEN_DELAY_MS);
    },
    [projectId, cancelClose, cancelOpen],
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
      // Before the `current` check, not after: while an open is still
      // pending there IS no current hover, so an early return here would
      // leave the timer armed and the card would appear on a link the
      // pointer had already left.
      const pending = pendingAnchor.current;
      if (pending && !(related && pending.contains(related))) {
        cancelOpen();
      }

      const current = hoverRef.current;
      if (!current) return;
      if (related) {
        if (current.anchorEl.contains(related)) return;
        if (cardRef.current?.contains(related)) return;
      }
      scheduleClose();
    },
    [scheduleClose, cancelOpen],
  );

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const anchor = el.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    // A broken wiki-link points at a fragment nothing on the page answers
    // to. Following it would scroll nowhere and leave the token in the URL.
    //
    // The `href === ""` arm is not redundant: an empty href is what a
    // broken link rendered as while the prefix was a custom scheme
    // react-markdown stripped, and `<a href="">` navigates to the current
    // URL - a full reload of the workspace. Kept as the belt to that
    // braces, for any other href markdown reduces to nothing.
    if (href === "" || href?.startsWith(BROKEN_HREF_PREFIX)) {
      e.preventDefault();
    }
  }, []);

  return (
    // event delegation over rendered MarkdownView anchors; keyboard a11y handled by the underlying anchors.
    // Event delegation over the anchors MarkdownView renders; keyboard access
    // is the anchors' own.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="[&_a[href^='#lore-broken:']]:text-danger-text [&_a[href^='#lore-broken:']]:decoration-danger-text/40 relative [&_a[href^='#lore-broken:']]:cursor-help [&_a[href^='#lore-broken:']]:decoration-wavy"
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
          attachmentByUuid={attachmentByUuid}
          references={references}
          cardRef={cardRef}
          onEnter={cancelClose}
          onLeave={scheduleClose}
          onAnchorHidden={closeNow}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

interface HoverCardPopoverProps {
  state: HoverState;
  projectId: number;
  attachmentByUuid: Map<string, AttachmentRef>;
  references: ElementReferenceRegistry;
  /**
   * Handed up so the delegated leave check can exempt the card: it is rendered
   * inside the pane but positioned `fixed` over it, and crossing into it must
   * not read as leaving the link.
   */
  cardRef: RefObject<HTMLDivElement | null>;
  onEnter: () => void;
  onLeave: () => void;
  /**
   * The link scrolled out of the visible pane, or left the document.
   */
  onAnchorHidden: () => void;
}

const HoverCardPopover = (props: HoverCardPopoverProps) => {
  const { state, projectId, attachmentByUuid } = props;
  const { tr } = useI18n<I18n, "en">();
  const target = state.target;

  // An attachment is the folio's own, already in hand: a lookup, never a
  // fetch. A reference's preview is its kind's, which fetches what it shows.
  const attachment =
    target.kind === "attachment"
      ? attachmentByUuid.get(target.fileId)
      : undefined;

  const { top, left } = useHoverCardPosition(
    state.anchorEl,
    props.onAnchorHidden,
  );

  return (
    // presentational popover that follows the anchor; no keyboard interaction expected.
    <div
      ref={props.cardRef}
      data-slot="wiki-link-hover-card"
      style={{ position: "fixed", top, left, zIndex: 50 }}
      className="bg-popover text-popover-foreground border-border w-[360px] max-w-[90vw] rounded-md border p-3 shadow-lg"
      onMouseEnter={props.onEnter}
      onMouseLeave={props.onLeave}
    >
      {target.kind === "broken" && (
        <div className="flex flex-col gap-1">
          <span className="text-danger-text flex items-center gap-1.5 text-sm font-semibold">
            <span aria-hidden>⚠</span>
            {tr("folios.wikilink.broken.title")}
          </span>
          <span className="text-muted-foreground text-xs">
            {tr(brokenReasonKey(target.reason, props.references) as never)}
          </span>
        </div>
      )}
      {target.kind === "ref" && (
        <target.ref.preview projectId={projectId} id={target.id} />
      )}
      {target.kind === "attachment" && !attachment && (
        <WikiLinkPreviewState loading={false} />
      )}
      {attachment && (
        <div className="flex flex-col gap-1.5">
          {attachment.mime?.startsWith("image/") && (
            <FileImage
              id={attachment.fileId}
              alt={attachment.name}
              className="max-h-48 w-full rounded-sm border object-contain"
            />
          )}
          <span className="text-sm font-semibold break-all">
            {attachment.name}
          </span>
          <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
            {attachment.size != null && (
              <span>{formatBytes(attachment.size)}</span>
            )}
            {attachment.mime && <span>· {attachment.mime}</span>}
          </div>
        </div>
      )}
    </div>
  );
};

export default WikiLinkHoverProvider;
