import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@alepha/ui/components/ui/command";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  AppWindow,
  FileText,
  Folder,
  LayoutGrid,
  Lock,
  PanelsTopLeft,
  Swords,
} from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import type { SearchController } from "@/api/controllers/SearchController.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import {
  type ProjectNavEntry,
  projectNavAtom,
} from "../../../atoms/projectNavAtom.ts";
import { spotlightOpenAtom } from "../../../atoms/spotlightOpenAtom.ts";
import { userProjectsAtom } from "../../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { formatReference } from "../element/typedReference.ts";
import { matchProjectNav } from "./matchProjectNav.ts";

interface SpotlightHit {
  kind: "quest" | "folio" | "directory";
  id: string;
  shortId: number;
  title: string;
  /**
   * One line of context — a quest's description, a folio's summary. Already
   * flattened and truncated by `SearchController`; render it as-is.
   */
  description?: string;
  protected?: boolean;
}

/**
 * The global search palette — ⌘K, or the magnifier in the header.
 *
 * Everything it shows comes from one action (`SearchController.search`),
 * already ranked and already in one row shape. The earlier version of this
 * component called the quest and folio endpoints side by side and
 * reconciled their three different shapes here; see that controller's doc
 * for why that moved to the server.
 *
 * TWO MODES, decided by whether a project is open.
 *
 * Inside one it searches that project's quests and folios, because that is what
 * `SearchController.search` is: `/projects/:projectId/search`, member-gated and
 * hard-filtered by project. There is no cross-project search to offer.
 *
 * Outside one — `/`, `/new-project`, `/account/*` — it lists the user's
 * projects and jumps to one. That is the only useful thing ⌘K can do there, and
 * those are exactly the pages where "take me to project X" is all anyone wants.
 * The heading names the mode, because someone who types a quest title on the
 * home page must be able to see why nothing matched.
 *
 * The project list is complete, not a recent-few sample, so the copy can say
 * "projects" without qualification — see the note on the filter below.
 *
 * ⌘K is bound HERE rather than on the header button. The two used to be one
 * concept, so the shortcut lived with the opener; now that the palette answers
 * off-project and the button does not render there, only an always-mounted
 * owner can keep the shortcut alive. This component is that owner.
 */
const Spotlight = (): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const [spotlight, setSpotlight] = useStore(spotlightOpenAtom);
  const [overview] = useStore(userProjectsAtom);
  const [projectNav] = useStore(projectNavAtom);
  const searchApi = useClient<SearchController>();

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SpotlightHit[]>([]);

  const projectId = project?.id;

  const search = useAction<[string], void>(
    {
      handler: async (q) => {
        if (projectId === undefined) return;
        const result = await searchApi.search({
          params: { projectId },
          query: { q },
        });
        setHits(result.hits as SpotlightHit[]);
      },
      debounce: 200,
    },
    [projectId, searchApi],
  );

  // Clearing the box clears the results immediately, not a debounce later:
  // stale hits under an empty input read as results for a query nobody
  // typed.
  const onQueryChange = (value: string): void => {
    setQuery(value);
    if (!value.trim()) {
      search.cancel();
      setHits([]);
      return;
    }
    void search.run(value.trim());
  };

  const close = (): void => {
    setSpotlight({ open: false });
    setQuery("");
    setHits([]);
  };

  // Reopening must not flash the previous search's hits — which is exactly why
  // this runs during render rather than after the commit that would show them.
  const [wasOpen, setWasOpen] = useState(spotlight.open);
  if (spotlight.open !== wasOpen) {
    setWasOpen(spotlight.open);
    if (spotlight.open) {
      setQuery("");
      setHits([]);
    }
  }

  // Capture phase for the same reason the folio workspace binds its shortcuts
  // there: ⌘K reaches a focused input otherwise.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "k"
      ) {
        return;
      }
      event.preventDefault();
      setSpotlight({ open: true });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [setSpotlight]);

  // Filtered here rather than on the server because the list is already
  // complete in the atom: `getHomeOverview` returns every membership with no
  // cap (`totalCount` is literally `projects.length`), so there is no
  // "+N more" tail this can fail to find. That is what lets the mode call
  // itself "Projects" rather than "Recent projects" — a switcher that silently
  // omits a project you own reads as a bug, not as a cap.
  const projectMatches = (overview?.projects ?? []).filter((it) => {
    const q = query.trim().toLowerCase();
    return !q || it.title.toLowerCase().includes(q);
  });

  // Pages and apps the sidebar currently offers, matched against the query.
  // See `matchProjectNav` for the ranking and why it happens client-side.
  const navMatches = matchProjectNav(projectNav, query);

  const goNav = async (entry: ProjectNavEntry): Promise<void> => {
    close();
    await router.push(entry.href);
  };

  const goProject = async (slug: string): Promise<void> => {
    close();
    await router.push("project", { params: { projectSlug: slug } });
  };

  const go = async (hit: SpotlightHit): Promise<void> => {
    // `projectId` gates the search itself (an API call); the navigation below
    // takes the slug. Both come from the same project, so one guard covers it.
    if (projectId === undefined) return;
    const params = { projectSlug: project?.slug ?? "" };
    close();
    if (hit.kind === "quest") {
      await router.push("projectQuest", {
        params: { ...params, shortId: String(hit.shortId) },
      });
      return;
    }
    if (hit.kind === "folio") {
      await router.push("projectFoliosFolio", {
        params: { ...params, shortId: String(hit.shortId) },
      });
      return;
    }
    // A directory has no route of its own — the workspace is where it is
    // reachable, through the tree.
    await router.push("projectFolios", { params });
  };

  const iconFor = (hit: SpotlightHit) => {
    if (hit.kind === "quest") return <Swords />;
    if (hit.kind === "directory") return <Folder />;
    if (hit.protected) return <Lock />;
    return <FileText />;
  };

  const quests = hits.filter((h) => h.kind === "quest");
  const folios = hits.filter((h) => h.kind !== "quest");

  const row = (hit: SpotlightHit) => (
    <CommandItem
      key={`${hit.kind}:${hit.id}`}
      value={`${hit.kind}:${hit.id}`}
      onSelect={() => void go(hit)}
    >
      {iconFor(hit)}
      {/* `min-w-0` is what lets both lines truncate: a flex child defaults to
          `min-width: auto`, so without it the column refuses to shrink below
          its longest line and the `#N` on the right gets pushed off. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{hit.title}</span>
        {hit.description && (
          <span className="text-muted-foreground truncate text-xs">
            {hit.description}
          </span>
        )}
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">
        {hit.kind !== "directory" && formatReference(hit.kind, hit.shortId)}
      </span>
    </CommandItem>
  );

  return (
    <CommandDialog
      open={spotlight.open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      /* `CommandDialog` sets position and padding but never a width, so it
         inherited `DialogContent`'s `sm:max-w-sm` — 384px. Widened HERE and
         not in `command.tsx`: that file is stock shadcn and
         `yarn w @alepha/ui sync` overwrites `components/ui/` wholesale. */
      className="sm:max-w-2xl"
      title={String(tr("spotlight.title"))}
      description={String(
        tr(
          projectId === undefined
            ? "spotlight.description.projects"
            : "spotlight.description",
        ),
      )}
    >
      {/* `CommandDialog` drops its children straight into the dialog
          without a `Command` around them, so the store the input and list
          subscribe to has to be supplied here.

          `shouldFilter={false}` because the filtering already happened on
          the server, ranked across types. Left on, cmdk would filter the
          rows AGAIN against each item's `value` — which is `kind:id`, not
          the title — and quietly hide every result. */}
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={onQueryChange}
          placeholder={String(
            tr(
              projectId === undefined
                ? "spotlight.placeholder.projects"
                : "spotlight.placeholder",
            ),
          )}
        />
        <CommandList>
          <CommandEmpty>
            {tr(
              projectId === undefined
                ? "spotlight.empty.projects"
                : query.trim()
                  ? "spotlight.empty"
                  : "spotlight.hint",
            )}
          </CommandEmpty>
          {projectId === undefined ? (
            projectMatches.length > 0 && (
              // The heading is the mode indicator. Without it, typing a quest
              // name here and getting nothing reads as broken search rather
              // than as the wrong surface.
              <CommandGroup heading={String(tr("spotlight.group.projects"))}>
                {projectMatches.map((it) => (
                  <CommandItem
                    key={it.id}
                    value={`project:${it.id}`}
                    onSelect={() => void goProject(it.slug)}
                  >
                    <LayoutGrid />
                    <span className="flex-1 truncate">{it.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )
          ) : (
            <>
              {/* Pages first. A page label is short and specific, so a match on
                  one is a strong signal of navigation intent — and when the
                  query is really a folio title it matches no page at all, so
                  this group simply does not render. */}
              {navMatches.length > 0 && (
                <CommandGroup heading={String(tr("spotlight.group.pages"))}>
                  {navMatches.map((entry) => (
                    <CommandItem
                      key={`nav:${entry.href}`}
                      value={`nav:${entry.href}`}
                      onSelect={() => void goNav(entry)}
                    >
                      {entry.kind === "app" ? <AppWindow /> : <PanelsTopLeft />}
                      <span className="flex-1 truncate">{entry.label}</span>
                      {entry.kind === "app" && (
                        <span className="text-muted-foreground text-xs">
                          {tr("spotlight.group.apps")}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {quests.length > 0 && (
                <CommandGroup heading={String(tr("spotlight.group.quests"))}>
                  {quests.map(row)}
                </CommandGroup>
              )}
              {folios.length > 0 && (
                <CommandGroup heading={String(tr("spotlight.group.folios"))}>
                  {folios.map(row)}
                </CommandGroup>
              )}
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
};

export default Spotlight;
