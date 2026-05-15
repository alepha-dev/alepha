import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { Separator } from "@alepha/ui/components/ui/separator";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Search,
  Tag,
} from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Folio } from "@/api/entities/folios.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { currentFolioAtom } from "../../atoms/currentFolioAtom.ts";
import { folioTagsAtom } from "../../atoms/folioTagsAtom.ts";
import { userFoliosAtom } from "../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../services/I18n.ts";

const expandStorageKey = (campaignId: number) =>
  `lor.folios.expand.${campaignId}`;

const readExpandState = (campaignId: number): Set<string> => {
  try {
    const raw = window.localStorage.getItem(expandStorageKey(campaignId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed);
  } catch {
    return new Set();
  }
};

const writeExpandState = (campaignId: number, expanded: Set<string>) => {
  try {
    if (expanded.size === 0) {
      window.localStorage.removeItem(expandStorageKey(campaignId));
    } else {
      window.localStorage.setItem(
        expandStorageKey(campaignId),
        JSON.stringify([...expanded]),
      );
    }
  } catch {
    // ignore (private mode, quota)
  }
};

const FoliosSidebar = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [folios] = useStore(userFoliosAtom);
  const [tags] = useStore(folioTagsAtom);
  const [current] = useStore(currentFolioAtom);
  const [campaign] = useStore(currentCampaignAtom);
  const campaignId = campaign ? String(campaign.id) : "";
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  // Hydrate expand state once per campaign, mirror writes back.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!campaign?.id) {
      setExpanded(new Set());
      return;
    }
    setExpanded(readExpandState(campaign.id));
  }, [campaign?.id]);
  useEffect(() => {
    if (!campaign?.id) return;
    writeExpandState(campaign.id, expanded);
  }, [campaign?.id, expanded]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return folios.filter((f) => {
      if (activeTag && !f.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        f.title.toLowerCase().includes(q) ||
        f.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [folios, deferredQuery, activeTag]);

  // When a filter is active (search or tag) the tree collapses to a flat
  // list of matches — hierarchy is only useful when browsing the full set.
  const isFiltering = deferredQuery.trim().length > 0 || activeTag != null;

  const tree = useMemo(() => buildFolioTree(filtered), [filtered]);

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r">
      <div className="flex items-center gap-2 px-4 py-3">
        <BookOpen className="size-5" />
        <h2 className="flex-1 text-sm font-semibold">{tr("folios.title")}</h2>
        <Button asChild size="icon" variant="ghost" className="size-7">
          <Link
            href={router.path("campaignFoliosNew", { params: { campaignId } })}
            aria-label={String(tr("folios.new"))}
          >
            <Plus className="size-4" />
          </Link>
        </Button>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={String(tr("folios.search"))}
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      {tags.length > 0 && (
        <>
          <div className="text-muted-foreground flex items-center gap-1 px-4 pt-1 pb-1 text-[10px] uppercase tracking-wider">
            <Tag className="size-3" />
            {tr("folios.tags")}
          </div>
          <div className="flex flex-wrap gap-1 px-3 pb-2">
            {tags.map((tag) => {
              const active = tag === activeTag;
              return (
                <button
                  type="button"
                  key={tag}
                  onClick={() => setActiveTag(active ? null : tag)}
                  className="appearance-none"
                >
                  <Badge
                    variant={active ? "default" : "outline"}
                    className="cursor-pointer text-[10px]"
                  >
                    {tag}
                  </Badge>
                </button>
              );
            })}
          </div>
        </>
      )}

      <Separator />

      <div className="flex-1 overflow-auto py-1">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground p-4 text-xs">
            {tr("folios.empty-list")}
          </p>
        ) : isFiltering ? (
          filtered.map((folio) => (
            <FolioRow
              key={folio.id}
              folio={folio}
              isActive={current?.id === folio.id}
              campaignId={campaignId}
              router={router}
              indent={0}
              hasChildren={false}
              isExpanded={false}
              onToggle={toggleExpand}
            />
          ))
        ) : (
          tree.roots.map((node) =>
            renderTreeNode(node, {
              campaignId,
              router,
              expanded,
              toggleExpand,
              activeId: current?.id,
              depth: 0,
            }),
          )
        )}
      </div>
    </aside>
  );
};

export default FoliosSidebar;

type TreeNode = { folio: Folio; children: TreeNode[] };
type TreeIndex = { roots: TreeNode[] };

const buildFolioTree = (flat: Folio[]): TreeIndex => {
  const byId = new Map<string, TreeNode>();
  for (const folio of flat) byId.set(folio.id, { folio, children: [] });
  const roots: TreeNode[] = [];
  // Sort alphabetically so each level is predictable.
  const sorted = [...flat].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
  for (const folio of sorted) {
    const node = byId.get(folio.id);
    if (!node) continue;
    if (folio.parentId && byId.has(folio.parentId)) {
      byId.get(folio.parentId)!.children.push(node);
    } else {
      // Either no parent set, or the parent was filtered out of the
      // current view — promote to root so the folio doesn't disappear.
      roots.push(node);
    }
  }
  return { roots };
};

interface FolioRowProps {
  folio: Folio;
  isActive: boolean;
  campaignId: string;
  router: ReturnType<typeof useRouter<AppRouter>>;
  indent: number;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}

const FolioRow = (props: FolioRowProps) => {
  const indentPx = 12 + props.indent * 14;
  return (
    <div className="flex items-center" style={{ paddingLeft: indentPx }}>
      {props.hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            props.onToggle(props.folio.id);
          }}
          className="text-muted-foreground hover:text-foreground -ml-1 mr-0.5 inline-flex size-5 items-center justify-center"
          aria-label={props.isExpanded ? "Collapse" : "Expand"}
        >
          {props.isExpanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
      ) : (
        <span className="text-muted-foreground/40 -ml-1 mr-0.5 inline-flex size-5 items-center justify-center">
          <FileText className="size-3" />
        </span>
      )}
      <Link
        href={props.router.path("campaignFoliosFolio", {
          params: {
            campaignId: props.campaignId,
            shortId: props.folio.shortId,
          },
        })}
        className={`hover:bg-muted flex flex-1 flex-col gap-0.5 px-1.5 py-1.5 text-sm transition-colors ${
          props.isActive ? "bg-muted" : ""
        }`}
      >
        <span className="line-clamp-1 truncate font-medium">
          {props.folio.title}
        </span>
        {props.folio.tags.length > 0 && (
          <span className="text-muted-foreground line-clamp-1 truncate text-[11px]">
            {props.folio.tags.map((t) => `#${t}`).join(" ")}
          </span>
        )}
      </Link>
    </div>
  );
};

interface RenderContext {
  campaignId: string;
  router: ReturnType<typeof useRouter<AppRouter>>;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  activeId: string | undefined;
  depth: number;
}

const renderTreeNode = (node: TreeNode, ctx: RenderContext): ReactElement => {
  const hasChildren = node.children.length > 0;
  const isExpanded = ctx.expanded.has(node.folio.id);
  return (
    <div key={node.folio.id}>
      <FolioRow
        folio={node.folio}
        isActive={ctx.activeId === node.folio.id}
        campaignId={ctx.campaignId}
        router={ctx.router}
        indent={ctx.depth}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        onToggle={ctx.toggleExpand}
      />
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) =>
            renderTreeNode(child, { ...ctx, depth: ctx.depth + 1 }),
          )}
        </div>
      )}
    </div>
  );
};
