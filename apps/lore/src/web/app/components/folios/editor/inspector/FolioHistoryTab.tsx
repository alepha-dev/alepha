import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { cn } from "@alepha/ui/lib/utils";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  ChevronRight,
  Clock,
  FilePlus2,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Tag,
  Type,
  User,
} from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";

import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { FolioRevision } from "@/api/entities/folioRevisions.ts";

/**
 * What `listHistory` actually returns, which is the revision row PLUS the
 * resolved author and the per-revision line/word numbers.
 *
 * Derived from the action rather than written out, so adding a field to
 * that response schema cannot leave this drifting behind it - the
 * silent-serialisation trap in CLAUDE.md cuts both ways, and a hand-copied
 * interface here would compile happily while missing whatever was added.
 */
type HistoryRevision = Awaited<
  ReturnType<FolioController["listHistory"]>
>[number];
import type { Folio } from "@/api/entities/folios.ts";

import type { I18n } from "../../../../services/I18n.ts";

export interface FolioHistoryTabProps {
  folio: Folio;
  /**
   * Changes whenever a save completes elsewhere in the workspace (the
   * chrome row's Save button, an unlock, an encrypt/remove-protection
   * transition) — `useFolioDraft`'s `savedAt`, threaded down through
   * `FolioInspector`. Included in the fetch effect's deps so THIS
   * component re-fetches after a save it didn't itself trigger, not just
   * on mount. Without it, `props.folio` (the route-loader snapshot,
   * frozen for the mount's lifetime, same premise as everywhere else in
   * this workspace) never changes identity on a same-folio save, so the
   * revision list — and the count `FolioMetaBar` reads — would silently
   * go stale the moment the user typed and hit Save while sitting on a
   * different inspector tab. Found live while verifying this task.
   */
  refreshedAt?: string;
  /**
   * Whether the History tab is the one the inspector is currently
   * showing. This component stays mounted on every tab (see
   * `FolioInspector`), so without this flag its fetch effect ran on every
   * folio open — a whole `listHistory` round-trip, returning up to ten
   * FULL content snapshots, to render a panel the user was not looking
   * at. Nothing outside this tab reads the revision list, so nothing needs
   * the rows until the user actually opens it.
   *
   * It gates the MOUNT fetch only. A `refreshedAt` that has moved since
   * mount means a save landed, which may have appended a revision, so that
   * fetch still runs on a tab the user never opened — the list has to be
   * current the moment the tab is revealed, and revealing it is not itself
   * a state change this component can see. What this drops is the request
   * per folio OPENED, which is the one that was never worth making; the
   * request per folio SAVED is unchanged from before.
   */
  active: boolean;
  /**
   * Fired after a successful revert — the caller (`useFolioActions`'s
   * `applyReverted`) re-syncs the draft buffer and the shared atoms, since
   * the server-reverted row does not otherwise reach this component's own
   * `props.folio` (a route-loader snapshot, frozen for the mount's
   * lifetime — same premise as everywhere else in this workspace).
   *
   * Typed `Promise<void>`, not `void` — `handleRevert` below `await`s it,
   * and that `await` is load-bearing (it's what keeps `setBusy(false)`
   * from firing before the baseline update lands, not just the network
   * call). A `void` signature would let a future edit drop the `await`
   * with nothing catching it — structural typing wouldn't complain.
   */
  onReverted: (folio: Folio) => Promise<void>;
}

/**
 * ⚠️ `tag-change` is still handled here even though the tag feature is
 * gone. Nothing PRODUCES that action anymore, but production rows already
 * carry it and this component has to keep labelling them — a revision list
 * that renders nothing for a real row is worse than one naming a feature
 * that no longer exists.
 */
const ActionLabel = (props: { action: FolioRevision["action"] }) => {
  const { tr } = useI18n<I18n, "en">();
  switch (props.action) {
    case "create":
      return <>{tr("folios.history.action.create")}</>;
    case "edit":
      return <>{tr("folios.history.action.edit")}</>;
    case "rename":
      return <>{tr("folios.history.action.rename")}</>;
    case "tag-change":
      return <>{tr("folios.history.action.tag-change")}</>;
    case "revert":
      return <>{tr("folios.history.action.revert")}</>;
  }
};

const actionIcon = (action: FolioRevision["action"]) => {
  switch (action) {
    case "create":
      return <FilePlus2 className="size-4" />;
    case "edit":
      return <Pencil className="size-4" />;
    case "rename":
      return <Type className="size-4" />;
    case "tag-change":
      return <Tag className="size-4" />;
    case "revert":
      return <RotateCcw className="size-4" />;
  }
};

/**
 * The History tab: revision list, ported wholesale from the deleted
 * `FolioHistoryPanel.tsx` (its `listHistory` / `revertHistory` /
 * `pinHistory` calls, expand-on-click rows, and the `grid-rows-[0fr]` →
 * `[1fr]` collapse animation are all unchanged — only the surrounding
 * chrome is restyled for the inspector).
 *
 * One thing this restyle deliberately does NOT add: an "agent" vs. "web"
 * author badge. Nothing in `folio_revisions` (or anywhere else in the
 * data model) records how a revision was made — `byUserId` is the same
 * column whether the edit came from the browser or from an MCP tool call,
 * because both authenticate as the same underlying user. Rendering a
 * badge would mean guessing, and a confidently wrong "agent"/"web" label
 * is worse than not showing one — see the task report.
 */
const FolioHistoryTab = (props: FolioHistoryTabProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const dialog = useDialog();
  const folioApi = useClient<FolioController>();

  const [revisions, setRevisions] = useState<HistoryRevision[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Whether the first fetch has come back. Separate from `revisions`
  // because "not fetched yet" and "fetched, and there are none" render
  // differently: since the fetch is deferred to the first time this tab
  // is shown (see `props.active`), an empty list is the state EVERY folio
  // starts in, and rendering the empty copy for it would flash "no
  // history yet" over a folio that has ten revisions, every time the user
  // opens the tab.
  const [loaded, setLoaded] = useState(false);
  // What the last fetch was for. Doubles as "have we ever fetched" (the
  // gate `props.active` opens) and as the guard that stops a plain
  // tab-switch back to History from re-fetching a list nothing has
  // invalidated — `props.active` is in the effect's deps, so without it
  // every visit to the tab would cost a request.
  const fetchedForRef = useRef<string | undefined>(undefined);
  // What `refreshedAt` was when this folio opened. A value different from
  // it means a save has landed since, which may have appended a revision
  // — the one case where the list is worth fetching for a tab the user
  // has not opened, because the meta bar's count would otherwise be
  // wrong. See `props.active`.
  const openedAtRef = useRef(props.refreshedAt);

  useEffect(() => {
    const key = `${props.folio.id}:${props.refreshedAt ?? ""}`;
    const savedSinceOpen = props.refreshedAt !== openedAtRef.current;
    if (
      !props.active &&
      !savedSinceOpen &&
      fetchedForRef.current === undefined
    ) {
      return;
    }
    if (fetchedForRef.current === key) return;
    fetchedForRef.current = key;
    let alive = true;
    folioApi
      .listHistory({ params: { id: props.folio.id } })
      .then((rows) => {
        if (!alive) return;
        setRevisions(rows);
        setLoaded(true);
      })
      // A failed load leaves `loaded` false, so the tab keeps rendering
      // nothing rather than claiming the folio has no history.
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [props.folio.id, props.refreshedAt, props.active, folioApi]);

  const refresh = async () => {
    const next = await folioApi.listHistory({
      params: { id: props.folio.id },
    });
    setRevisions(next);
  };

  const handleRevert = async (revisionId: string) => {
    const confirmed = await dialog.confirm({
      title: tr("folios.history.revert-confirm-title"),
      description: tr("folios.history.revert-confirm-body"),
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const updated = await folioApi.revertHistory({
        params: { id: props.folio.id, revisionId },
      });
      // No `refresh()` call here (unlike `handlePinToggle` below, which
      // still needs one). `onReverted` (`useFolioActions.applyReverted`)
      // always re-baselines `useFolioDraft.savedAt` on a successful
      // revert — even when the folio is protected and still locked, see
      // that function's own doc — and `savedAt` is threaded down as
      // `props.refreshedAt`, which sits in this component's own fetch
      // effect's deps above. That effect re-fires and re-fetches on its
      // own; calling `refresh()` here too was a second, redundant
      // `listHistory` GET landing at almost the same moment, for the
      // same reason, every single revert.
      await props.onReverted(updated as Folio);
    } finally {
      setBusy(false);
    }
  };

  const handlePinToggle = async (revision: FolioRevision) => {
    await folioApi.pinHistory({
      params: { id: props.folio.id, revisionId: revision.id },
      body: { pinned: !revision.pinned },
    });
    await refresh();
  };

  if (!loaded) return <div className="px-3 py-4" />;

  if (revisions.length === 0) {
    return (
      <p className="text-muted-foreground px-3 py-4 text-center text-xs italic">
        {tr("folios.editor.inspector.history-empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="divide-border flex flex-col divide-y">
        {revisions.map((revision, index) => {
          const isExpanded = expandedId === revision.id;
          // The comparison against the next-older revision happens on the
          // SERVER now - `listHistory` returns the line and word deltas
          // already computed, so nothing here needs the neighbouring row.
          const isNewest = index === 0;
          const toggle = () => setExpandedId(isExpanded ? null : revision.id);
          return (
            <div key={revision.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={toggle}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle();
                  }
                }}
                className="hover:bg-accent/50 flex items-center gap-2 px-3 py-2.5 transition-colors select-none"
              >
                <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
                  {actionIcon(revision.action)}
                </span>
                <div className="ml-1 flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm leading-tight font-medium">
                    <ActionLabel action={revision.action} />
                  </span>
                  <span className="text-muted-foreground folio-mono flex items-center gap-1 text-[11px] leading-tight">
                    <Clock className="size-3 shrink-0" />
                    {dt.of(revision.at).fromNow()}
                    {revision.pinned && (
                      <>
                        <span aria-hidden>·</span>
                        <Pin className="size-3 shrink-0" />
                        {tr("folios.history.pinned-badge")}
                      </>
                    )}
                  </span>
                </div>
                {/* Actions: intercept clicks so the menu never toggles the row. */}
                {/* Row expander; the toggle button inside is the control. */}
                {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
                <div
                  className="shrink-0"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          aria-label={tr("folios.history.actions")}
                        />
                      }
                    >
                      <MoreVertical className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => handlePinToggle(revision)}
                      >
                        {revision.pinned ? (
                          <PinOff className="size-4" />
                        ) : (
                          <Pin className="size-4" />
                        )}
                        {tr(
                          revision.pinned
                            ? "folios.history.unpin"
                            : "folios.editor.inspector.keep",
                        )}
                      </DropdownMenuItem>
                      {!isNewest && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleRevert(revision.id)}
                            disabled={busy}
                          >
                            <RotateCcw className="size-4" />
                            {tr("folios.editor.inspector.revert")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
                  <ChevronRight
                    className={cn(
                      "size-4 transition-transform duration-200",
                      isExpanded && "rotate-90",
                    )}
                  />
                </span>
              </div>

              {/* Animated collapse: grid-rows 0fr→1fr interpolates height
                  without measuring. Body stays mounted so it transitions. */}
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <div className="border-t px-3 py-2.5">
                    <RevisionSummary revision={revision} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground/80 border-t px-3 py-2.5 text-[11px]">
        {tr("folios.editor.inspector.history-footer")}
      </p>
    </div>
  );
};

/**
 * One revision, as a short list of facts rather than as text.
 *
 * It replaces a side-by-side before/after view of the two snapshots. That
 * view was honest but unusable: two `<pre>` columns inside a 320px
 * inspector gave each about 140px, so every line wrapped two or three
 * times and both boxes scrolled independently. Reading it meant comparing
 * two ~140px-wide walls of pink and grey, which is harder than opening the
 * folio.
 *
 * The questions it actually has to answer are "who touched this" and "how
 * much moved", and both fit on one line each. The snapshots are still
 * fetched (`folio_history` serves them to agents) and reverting still
 * works from the row menu - what is gone is drawing them.
 *
 * ⚠️ No new i18n keys, deliberately. Every row here is a name, a signed
 * number or an arrow between two values, all of which read the same in
 * every locale. A key-value list would have needed a label per row in
 * both catalogues to say things the values already say.
 */
const RevisionSummary = (props: { revision: HistoryRevision }) => {
  const { tr } = useI18n<I18n, "en">();
  const r = props.revision;
  const changed = r.linesAdded > 0 || r.linesRemoved > 0;

  return (
    <dl className="flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-2">
        <dt className="sr-only">{tr("folios.history.action.edit")}</dt>
        <dd className="flex min-w-0 items-center gap-2">
          {r.byAvatarUrl ? (
            <img
              src={r.byAvatarUrl}
              alt=""
              className="size-5 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full">
              <User className="size-3" />
            </span>
          )}
          <span className="truncate font-medium">
            {/* A revision outlives its author: `byUserId` is `set null` on
                user deletion so the content survives the account. Reusing
                the string the feedback threads already show for the same
                situation rather than minting a second one. */}
            {r.byUsername ?? String(tr("feedback.thread.unknownAuthor"))}
          </span>
        </dd>
      </div>

      {changed && (
        <div className="flex items-center gap-2">
          <dt className="sr-only">Lines</dt>
          <dd className="flex items-center gap-2 font-mono">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{r.linesAdded}
            </span>
            <span className="text-destructive">−{r.linesRemoved}</span>
            <span className="text-muted-foreground/70">
              {r.wordsBefore} → {r.words}
            </span>
          </dd>
        </div>
      )}

      {r.previousTitle !== undefined && (
        <div className="flex min-w-0 items-start gap-2">
          <dt className="sr-only">{tr("folios.history.action.rename")}</dt>
          <dd className="text-muted-foreground min-w-0 truncate">
            <span className="line-through">{r.previousTitle}</span>
            <span className="mx-1.5">→</span>
            <span className="text-foreground">{r.titleSnapshot}</span>
          </dd>
        </div>
      )}

      {/* A revision that moved no lines and no title changed the summary,
          which is the only other field `decideRevisionAction` records.
          Saying so beats an empty panel that looks broken. */}
      {!changed && r.previousTitle === undefined && (
        <div className="text-muted-foreground/70">
          {r.words} · {tr("folios.history.action.edit")}
        </div>
      )}
    </dl>
  );
};

export default FolioHistoryTab;
