import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { History, Link2, ListTree } from "lucide-react";
import type { ReactElement } from "react";
import type { Folio } from "@/api/entities/folios.ts";
import type { I18n } from "../../../../services/I18n.ts";
import FolioHistoryTab from "./FolioHistoryTab.tsx";
import FolioLinksTab from "./FolioLinksTab.tsx";
import FolioOutlineTab from "./FolioOutlineTab.tsx";
import FolioPinnedBudget from "./FolioPinnedBudget.tsx";

export type FolioInspectorTab = "outline" | "history" | "links";

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
   * Bubbled up from the History tab so `FolioMetaBar` can show
   * "$3 revisions" without a fetch of its own.
   */
  onRevisionCount: (count: number) => void;
  /**
   * `useFolioDraft`'s `savedAt` — threaded through to `FolioHistoryTab`
   * so it re-fetches after a save that happened while History wasn't the
   * active tab (see that component's own doc). Not in the brief's
   * original interface; added after finding live that the revision count
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
   * down to the Outline tab only. `null` until the MDXEditor's lazy chunk
   * mounts.
   */
  contentElement: HTMLElement | null;
}

const TABS: {
  id: FolioInspectorTab;
  labelKey: string;
  icon: typeof ListTree;
}[] = [
  {
    id: "outline",
    labelKey: "folios.editor.inspector.outline",
    icon: ListTree,
  },
  { id: "history", labelKey: "folios.editor.inspector.history", icon: History },
  { id: "links", labelKey: "folios.editor.inspector.links", icon: Link2 },
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
    <div className="border-border flex h-full min-h-0 w-[320px] flex-none flex-col overflow-hidden border-l">
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
              "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors",
              props.tab === t.id
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5" />
            {tr(t.labelKey)}
          </button>
        ))}
      </div>

      {/*
        All three tabs stay mounted; only the active one is shown (`hidden`,
        not a conditional unmount). This is load-bearing for History, not
        just an optimization: `FolioHistoryTab` fetches `listHistory` and
        reports the count back via `onRevisionCount` from a mount effect.
        Outline is the DEFAULT tab, so a naive "only render the active tab"
        version would never mount History (and never fetch, and never call
        `onRevisionCount`) until the user clicked over to it — the meta
        bar's "$3 revisions" would read a false "0 revisions" for every
        folio with real history, for as long as the user stayed on Outline.
        Found live while verifying this task, not in the original brief.
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
              refreshedAt={props.savedAt}
              onReverted={props.onReverted}
              onRevisionCount={props.onRevisionCount}
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
      </div>

      {props.folio && (
        <FolioPinnedBudget folio={props.folio} content={props.content} />
      )}
    </div>
  );
};

export default FolioInspector;
