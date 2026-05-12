import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { Separator } from "@alepha/ui/components/ui/separator";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { BookOpen, Plus, Search, Tag } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { currentFolioAtom } from "../../atoms/currentFolioAtom.ts";
import { folioTagsAtom } from "../../atoms/folioTagsAtom.ts";
import { userFoliosAtom } from "../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../services/I18n.ts";

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
        ) : (
          filtered.map((folio) => {
            const isActive = current?.id === folio.id;
            return (
              <Link
                key={folio.id}
                href={router.path("campaignFoliosFolio", {
                  params: { campaignId, id: folio.id },
                })}
                className={`hover:bg-muted flex flex-col gap-0.5 px-4 py-2 text-sm transition-colors ${
                  isActive ? "bg-muted" : ""
                }`}
              >
                <span className="line-clamp-1 truncate font-medium">
                  {folio.title}
                </span>
                {folio.tags.length > 0 && (
                  <span className="text-muted-foreground line-clamp-1 truncate text-[11px]">
                    {folio.tags.map((t) => `#${t}`).join(" ")}
                  </span>
                )}
              </Link>
            );
          })
        )}
      </div>
    </aside>
  );
};

export default FoliosSidebar;
