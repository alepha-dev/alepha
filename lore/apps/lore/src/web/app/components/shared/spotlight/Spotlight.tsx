import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@alepha/ui/command";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  AppWindow,
  FileText,
  Flag,
  Folder,
  Inbox,
  Layers,
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
  kind: "quest" | "folio" | "directory" | "epic" | "release" | "feedback";
  id: string;
  shortId: number;
  title: string;
  /**
   * A release's tag: its page is addressed by tag, never by number.
   */
  tag?: string;
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
    // Epics, releases and feedback are found by number only (#Q2228), and
    // each opens where its own list would open it.
    if (hit.kind === "epic") {
      await router.push("projectEpic", {
        params: { ...params, epicNumber: String(hit.shortId) },
      });
      return;
    }
    if (hit.kind === "release") {
      // A release page is addressed by its TAG. A release from before tags
      // were required has none, and the list is the one place it can open.
      await (hit.tag
        ? router.push("projectRelease", {
            params: { ...params, releaseTag: hit.tag },
          })
        : router.push("projectReleases", { params }));
      return;
    }
    if (hit.kind === "feedback") {
      // `?feedback=`, the address every `[[#P12]]` link already uses.
      await router.push("projectFeedback", {
        params,
        query: { feedback: String(hit.shortId) },
      });
      return;
    }
    // A directory has no route of its own — the workspace is where it is
    // reachable, through the tree.
    await router.push("projectFolios", { params });
  };

  // The epic, release and feedback glyphs are their sidebar entries' own
  // (`capabilityNav.ts`), so a row reads as the page it opens.
  const iconFor = (hit: SpotlightHit) => {
    if (hit.kind === "quest") return <Swords />;
    if (hit.kind === "epic") return <Layers />;
    if (hit.kind === "release") return <Flag />;
    if (hit.kind === "feedback") return <Inbox />;
    if (hit.kind === "directory") return <Folder />;
    if (hit.protected) return <Lock />;
    return <FileText />;
  };

  const hitRows = (kind: (hit: SpotlightHit) => boolean): SpotlightRow[] =>
    hits
      .filter(kind)
      .map((hit) => ({ key: `${hit.kind}:${hit.id}`, kind: "hit", hit }));

  // The palette is data-driven: one group per heading, in the order they
  // render, each dropped when it has nothing to show. Outside a project the
  // only group is the project switcher; inside one, pages come first.
  const groups: SpotlightGroup[] = (
    projectId === undefined
      ? [
          {
            // The heading is the mode indicator. Without it, typing a quest
            // name here and getting nothing reads as broken search rather
            // than as the wrong surface.
            key: "projects",
            heading: tr("spotlight.group.projects"),
            items: projectMatches.map((it): SpotlightRow => ({
              key: `project:${it.id}`,
              kind: "project",
              project: it,
            })),
          },
        ]
      : [
          {
            // Pages first. A page label is short and specific, so a match on
            // one is a strong signal of navigation intent - and when the
            // query is really a folio title it matches no page at all, so
            // this group simply does not render.
            key: "pages",
            heading: tr("spotlight.group.pages"),
            items: navMatches.map((entry): SpotlightRow => ({
              key: `nav:${entry.href}`,
              kind: "nav",
              entry,
            })),
          },
          {
            key: "quests",
            heading: tr("spotlight.group.quests"),
            items: hitRows((h) => h.kind === "quest"),
          },
          {
            key: "epics",
            heading: tr("spotlight.group.epics"),
            items: hitRows((h) => h.kind === "epic"),
          },
          {
            key: "releases",
            heading: tr("spotlight.group.releases"),
            items: hitRows((h) => h.kind === "release"),
          },
          {
            key: "feedback",
            heading: tr("spotlight.group.feedback"),
            items: hitRows((h) => h.kind === "feedback"),
          },
          {
            key: "folios",
            heading: tr("spotlight.group.folios"),
            items: hitRows((h) => h.kind === "folio" || h.kind === "directory"),
          },
        ]
  ).filter((group) => group.items.length > 0);

  const row = (item: SpotlightRow) => {
    if (item.kind === "project") {
      return (
        <CommandItem
          key={item.key}
          value={item}
          onClick={() => void goProject(item.project.slug)}
        >
          <LayoutGrid />
          <span className="flex-1 truncate">{item.project.title}</span>
        </CommandItem>
      );
    }
    if (item.kind === "nav") {
      return (
        <CommandItem
          key={item.key}
          value={item}
          onClick={() => void goNav(item.entry)}
        >
          {item.entry.kind === "app" ? <AppWindow /> : <PanelsTopLeft />}
          <span className="flex-1 truncate">{item.entry.label}</span>
          {item.entry.kind === "app" && (
            <span className="text-muted-foreground text-xs">
              {tr("spotlight.group.apps")}
            </span>
          )}
        </CommandItem>
      );
    }
    const hit = item.hit;
    return (
      <CommandItem key={item.key} value={item} onClick={() => void go(hit)}>
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
  };

  return (
    <CommandDialog
      open={spotlight.open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      /* `CommandDialog` sets position and padding but never a width, so it
         inherited `DialogContent`'s `sm:max-w-sm` - 384px. Widened HERE and
         not in `Command.tsx`: the width is this spotlight's, and every other
         command dialog keeps its own. */
      className="sm:max-w-2xl"
      title={tr("spotlight.title")}
      description={tr(
        projectId === undefined
          ? "spotlight.description.projects"
          : "spotlight.description",
      )}
    >
      {/* `mode="none"` because the filtering already happened on the server,
          ranked across types. Left on `list`, the palette would rank the rows
          AGAIN against their text and could reorder or hide results the
          server put first. The query is controlled here, because typing is
          what sends the search. */}
      <Command<SpotlightRow>
        items={groups}
        mode="none"
        value={query}
        onValueChange={onQueryChange}
      >
        <CommandInput
          placeholder={tr(
            projectId === undefined
              ? "spotlight.placeholder.projects"
              : "spotlight.placeholder",
          )}
        />
        <CommandEmpty>
          {tr(
            projectId === undefined
              ? "spotlight.empty.projects"
              : query.trim()
                ? "spotlight.empty"
                : "spotlight.hint",
          )}
        </CommandEmpty>
        <CommandList>
          {(group: SpotlightGroup) => (
            <CommandGroup
              key={group.key}
              items={group.items}
              heading={group.heading}
            >
              {row}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
};

/**
 * One row of the palette: a project to switch to, a page or app the sidebar
 * offers, or a search hit. Tagged so each renders and navigates its own way.
 */
type SpotlightRow =
  | {
      key: string;
      kind: "project";
      project: { id: number; slug: string; title: string };
    }
  | { key: string; kind: "nav"; entry: ProjectNavEntry }
  | { key: string; kind: "hit"; hit: SpotlightHit };

interface SpotlightGroup {
  [key: string]: unknown;
  key: string;
  heading: string;
  items: SpotlightRow[];
}

export default Spotlight;
