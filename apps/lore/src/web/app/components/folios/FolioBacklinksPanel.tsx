import { Button } from "@alepha/ui/components/ui/button";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ArrowUpRight, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";

export interface FolioBacklinksPanelProps {
  folioId: string;
  campaignId: string;
}

interface LinkRef {
  shortId: number;
  title: string;
}

interface LinksPayload {
  outbound: LinkRef[];
  inbound: LinkRef[];
}

const FolioBacklinksPanel = (props: FolioBacklinksPanelProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const folioApi = useClient<FolioController>();
  const [links, setLinks] = useState<LinksPayload | null>(null);

  /**
   * Fetch outbound + inbound link refs whenever the active folio changes.
   * Read-only and cheap — two indexed scans on `folio_links` + a single
   * resolution `findMany` on `folios`.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await folioApi.getLinks({
          params: { id: props.folioId },
        });
        if (!cancelled) setLinks(result);
      } catch {
        // Silent: links are a nice-to-have. A failed fetch just hides
        // the panel rather than blocking folio rendering.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.folioId, folioApi]);

  if (!links || (links.outbound.length === 0 && links.inbound.length === 0)) {
    return null;
  }

  const renderRefs = (refs: LinkRef[]) => (
    <ul className="flex flex-col gap-1">
      {refs.map((ref) => (
        <li key={ref.shortId}>
          <Button asChild variant="ghost" size="sm" className="h-7 px-2">
            <Link
              href={router.path("campaignFoliosFolio", {
                params: {
                  campaignId: props.campaignId,
                  shortId: String(ref.shortId),
                },
              })}
            >
              <ArrowUpRight className="size-3.5" />
              <span className="truncate">{ref.title}</span>
              <span className="text-muted-foreground text-[10px]">
                #{ref.shortId}
              </span>
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  );

  return (
    <aside className="mt-8 border-t pt-4">
      <div className="flex items-center gap-1.5">
        <Link2 className="text-muted-foreground size-3.5" />
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {tr("folios.backlinks.title")}
        </span>
      </div>
      <div className="mt-3 grid gap-6 sm:grid-cols-2">
        {links.inbound.length > 0 && (
          <section>
            <h3 className="text-muted-foreground mb-1.5 text-[11px] uppercase tracking-wide">
              {tr("folios.backlinks.inbound")}
            </h3>
            {renderRefs(links.inbound)}
          </section>
        )}
        {links.outbound.length > 0 && (
          <section>
            <h3 className="text-muted-foreground mb-1.5 text-[11px] uppercase tracking-wide">
              {tr("folios.backlinks.outbound")}
            </h3>
            {renderRefs(links.outbound)}
          </section>
        )}
      </div>
    </aside>
  );
};

export default FolioBacklinksPanel;
