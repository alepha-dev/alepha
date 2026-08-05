import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ArrowUpRight, Link2 } from "lucide-react";
import type { FolioLinks } from "@/api/schemas/folioResourceSchema.ts";
import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";

export interface FolioBacklinksPanelProps {
  links: FolioLinks | undefined;
  projectId: string;
}

type Ref = FolioLinks["outbound"][number] | FolioLinks["inbound"][number];

const FolioBacklinksPanel = (props: FolioBacklinksPanelProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const { links } = props;

  if (!links || (links.outbound.length === 0 && links.inbound.length === 0)) {
    return null;
  }

  const renderRefs = (refs: Ref[]) => (
    <ul className="flex flex-col gap-1">
      {refs.map((ref) => {
        const route =
          ref.kind === "quest" ? "projectQuest" : "projectFoliosFolio";
        // For folio refs that live in a folio directory, show the
        // full path (e.g. `specs/apps/admin`) rather than the bare title
        // — bare names (`admin`, `roadmap`) repeat across buckets and
        // need the directory chain to be unambiguous.
        const pathSegments = ref.kind === "folio" ? ref.path : undefined;
        const displayLabel =
          pathSegments && pathSegments.length > 0
            ? `${pathSegments.map((p) => p.name).join("/")}/${ref.title}`
            : ref.title;
        return (
          <li key={`${ref.kind}-${ref.shortId}`}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              render={
                <Link
                  href={router.path(route, {
                    params: {
                      projectId: props.projectId,
                      shortId: String(ref.shortId),
                    },
                  })}
                />
              }
            >
              <ArrowUpRight className="size-3.5" />
              <span className="truncate">{displayLabel}</span>
              <span className="text-muted-foreground text-[10px]">
                {ref.kind === "quest" ? `Q#${ref.shortId}` : `#${ref.shortId}`}
              </span>
            </Button>
          </li>
        );
      })}
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
