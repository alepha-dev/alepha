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
import { FileText, Folder, Lock, Swords } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import type { SearchController } from "@/api/controllers/SearchController.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { spotlightOpenAtom } from "../../../atoms/spotlightOpenAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

interface SpotlightHit {
  kind: "quest" | "folio" | "directory";
  id: string;
  shortId: number;
  title: string;
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
 * Scoped to the open project, because quests and folios both are. Outside
 * one there is nothing to search, so the input says so rather than
 * accepting a query it cannot answer.
 *
 * Since `HeaderSearchButton` hides both openers off a project, the palette
 * can no longer be opened there and the `projectId === undefined` branches
 * below are unreachable. They are kept on purpose: this component is mounted
 * app-wide, so the day a third opener appears they are the difference between
 * a disabled input and a crash.
 */
const Spotlight = (): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const [spotlight, setSpotlight] = useStore(spotlightOpenAtom);
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
    search.run(value.trim());
  };

  const close = (): void => {
    setSpotlight({ open: false });
    setQuery("");
    setHits([]);
  };

  // Reopening must not flash the previous search's hits.
  useEffect(() => {
    if (!spotlight.open) return;
    setQuery("");
    setHits([]);
  }, [spotlight.open]);

  const go = async (hit: SpotlightHit): Promise<void> => {
    if (projectId === undefined) return;
    const params = { projectId: String(projectId) };
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
      <span className="flex-1 truncate">{hit.title}</span>
      <span className="text-muted-foreground text-xs tabular-nums">
        #{hit.shortId}
      </span>
    </CommandItem>
  );

  return (
    <CommandDialog
      open={spotlight.open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={String(tr("spotlight.title"))}
      description={String(tr("spotlight.description"))}
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
                ? "spotlight.no-project"
                : "spotlight.placeholder",
            ),
          )}
          disabled={projectId === undefined}
        />
        <CommandList>
          <CommandEmpty>
            {tr(query.trim() ? "spotlight.empty" : "spotlight.hint")}
          </CommandEmpty>
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
        </CommandList>
      </Command>
    </CommandDialog>
  );
};

export default Spotlight;
