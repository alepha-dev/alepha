import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { PanelRightClose } from "lucide-react";
import type { ReactElement } from "react";

import type { Folio } from "@/api/entities/folios.ts";

import type { I18n } from "../../../../services/I18n.ts";
import FolioAttachmentsTab from "./FolioAttachmentsTab.tsx";
import FolioHistoryTab from "./FolioHistoryTab.tsx";
import FolioLinksTab from "./FolioLinksTab.tsx";
import FolioOutlineTab from "./FolioOutlineTab.tsx";
import FolioPinnedBudget from "./FolioPinnedBudget.tsx";

export type FolioInspectorTab = "outline" | "history" | "links" | "attachments";

export interface FolioInspectorProps {
  /**
   * `undefined` in create mode — the History and Links tabs need a saved
   * row (revisions and resolved wiki-links both require one); the Outline
   * tab works either way, since it only parses `content`.
   */
  folio?: Folio;
  /**
   * The document's live markdown — same buffer the editor shows, so the
   * Outline tab (and the pinned-budget footer) never lag behind typing.
   */
  content: string;
  tab: FolioInspectorTab;
  onTabChange: (tab: FolioInspectorTab) => void;
  /**
   * Closes the pane from the control at the end of its own tab row —
   * `view.inspector`, the same handler ⇧⌘\ and View▸ drive.
   */
  onCollapse: () => void;
  /**
   * `useFolioDraft`'s `savedAt` — threaded through to `FolioHistoryTab`
   * so it re-fetches after a save that happened while History wasn't the
   * active tab (see that component's own doc). Not in the brief's
   * original interface; added after finding live that the revision list
   * otherwise went stale the moment the user saved from Outline or Links.
   */
  savedAt?: string;
  /**
   * Bubbled up from the History tab after a successful revert — see
   * `useFolioActions.applyReverted`'s doc for why the sync has to happen
   * there rather than by re-reading `props.folio`. Typed `Promise<void>`
   * — `FolioHistoryTab.handleRevert` `await`s it, and that `await` is
   * load-bearing (see that prop's own doc there).
   */
  onReverted: (folio: Folio) => Promise<void>;
  /**
   * The editor's contenteditable root (or an ancestor of it) — threaded
   * down to the Outline tab only. `null` until the editor mounts.
   */
  contentElement: HTMLElement | null;
  /**
   * True while the open folio is end-to-end encrypted. The Attachments tab
   * refuses uploads then — plaintext bytes must not sit beside encrypted
   * content, the same rule `useFolioImageUpload` enforces for the editor's
   * own image button.
   */
  protectedFolio?: boolean;
}

// Labels only, no icons: the design's tab row is three words and nothing
// else. Icons at this size read as noise next to a 320px pane whose whole
// job is dense text.
const TABS: { id: FolioInspectorTab; labelKey: string }[] = [
  { id: "outline", labelKey: "folios.editor.inspector.outline" },
  { id: "history", labelKey: "folios.editor.inspector.history" },
  { id: "links", labelKey: "folios.editor.inspector.links" },
  { id: "attachments", labelKey: "folios.editor.inspector.attachments" },
];

/**
 * The right-hand inspector: a 320px pane with three tabs (Outline /
 * History / Links) and a pinned-context budget footer shown only for
 * pinned folios. Mounted from `FolioWorkspaceContent.tsx` — inside the
 * per-folio `key`, unlike the tree pane, because every tab here needs
 * something that lives in that keyed subtree (the draft's live content,
 * `useFolioActions`'s revert sync). Its OPEN/CLOSED state and active tab
 * are threaded down as props from `FolioWorkspace.tsx` instead, one level
 * above the key, for the same reason the tree pane's own collapse state
 * lives there: a boolean owned by this keyed subtree would reset to its
 * default on every folio-to-folio navigation.
 */
const FolioInspector = (props: FolioInspectorProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div
      data-slot="folio-inspector"
      className="border-border flex h-full min-h-0 w-[320px] flex-none flex-col overflow-hidden border-l"
    >
      <div
        role="tablist"
        aria-label={String(tr("folios.editor.action.toggle-inspector"))}
        className="border-border flex h-10 flex-none items-center gap-0.5 border-b px-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={props.tab === t.id}
            onClick={() => props.onTabChange(t.id)}
            className={cn(
              "flex h-6.5 items-center rounded-md px-2.5 text-xs font-medium transition-colors",
              props.tab === t.id
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tr(t.labelKey)}
          </button>
        ))}
        <div className="flex-1" />
        {/* Collapsing the pane from inside it. Without this the only ways
            out are ⇧⌘\ and the View menu, neither of which is visible from
            here — the design puts a control at the end of the tab row. */}
        <button
          type="button"
          onClick={props.onCollapse}
          aria-label={String(tr("folios.editor.inspector.collapse"))}
          title={String(tr("folios.editor.inspector.collapse"))}
          className="text-muted-foreground hover:text-foreground flex size-6.5 items-center justify-center rounded-md transition-colors"
        >
          <PanelRightClose className="size-3.5" />
        </button>
      </div>

      {/*
        All tabs stay mounted; only the active one is shown (`hidden`, not
        a conditional unmount) — it keeps each tab's local state (History's
        expanded row, Outline's scroll) across a tab switch.

        History used to fetch `listHistory` from a plain mount effect, and
        that made staying mounted load-bearing rather than merely nice:
        Outline is the DEFAULT tab, so unmounting the others would have
        left the meta bar reading a false "0 revisions" until the user
        clicked over. Neither half of that is true anymore — the meta bar
        is gone, and History takes an `active` flag so a folio open no
        longer pays for a revision list nobody is looking at.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={props.tab === "outline" ? undefined : "hidden"}>
          <FolioOutlineTab
            content={props.content}
            contentElement={props.contentElement}
          />
        </div>
        <div className={props.tab === "history" ? undefined : "hidden"}>
          {props.folio ? (
            <FolioHistoryTab
              folio={props.folio}
              active={props.tab === "history"}
              refreshedAt={props.savedAt}
              onReverted={props.onReverted}
            />
          ) : (
            <p className="text-muted-foreground px-3 py-4 text-center text-xs italic">
              {tr("folios.editor.inspector.history-empty")}
            </p>
          )}
        </div>
        <div className={props.tab === "links" ? undefined : "hidden"}>
          <FolioLinksTab folio={props.folio} />
        </div>
        <div className={props.tab === "attachments" ? undefined : "hidden"}>
          <FolioAttachmentsTab
            folioId={props.folio?.id}
            projectId={props.folio?.projectId}
            disabled={props.protectedFolio}
          />
        </div>
      </div>

      {props.folio && (
        <FolioPinnedBudget folio={props.folio} content={props.content} />
      )}
    </div>
  );
};

export default FolioInspector;
