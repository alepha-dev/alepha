import { Badge, Button, CardContent } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Link2 } from "lucide-react";

import type { OwnedEstateResource } from "../../../../../api/schemas/ownedEstateResourceSchema.ts";

export interface ProjectSettingsHomeEstateRowProps {
  estate: OwnedEstateResource;
  /**
   * Whether this project may deploy onto it: home and loan are two facts
   * (#E126), and an estate homed here need not be lent here.
   */
  lentHere: boolean;
  /**
   * Offered when the reader holds `estate:lend` and the estate is not lent
   * here yet.
   */
  onLend?: (estate: OwnedEstateResource) => void;
  busy: boolean;
}

/**
 * One estate this project is the home of: its members manage it, each by
 * their rank. The slug opens its console, which every member of the home
 * can read.
 */
const ProjectSettingsHomeEstateRow = (
  props: ProjectSettingsHomeEstateRowProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const estate = props.estate;
  // The other projects that deploy onto it.
  const elsewhere = estate.projects.length - (props.lentHere ? 1 : 0);

  return (
    <CardContent
      data-testid="home-estate-row"
      className="flex flex-wrap items-center gap-3 px-4 py-3"
    >
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          {estate.type === "bay" ? (
            <Link
              href={router.path("bay", { params: { estateId: estate.id } })}
              className="truncate hover:underline"
            >
              {estate.slug}
            </Link>
          ) : (
            <span className="truncate">{estate.slug}</span>
          )}
          {estate.label && (
            <span className="text-muted-foreground truncate text-xs font-normal">
              {estate.label}
            </span>
          )}
        </span>
        <span className="text-muted-foreground text-xs">
          {props.lentHere
            ? tr("estates.home.lentHere")
            : tr("estates.home.notLentHere")}
          {elsewhere > 0 &&
            ` · ${tr("estates.home.lentTo", { args: [String(elsewhere)] })}`}
        </span>
      </div>
      <Badge variant={estate.online ? "default" : "outline"}>
        {estate.type === "cloudflare"
          ? tr("estates.type.cloudflare")
          : estate.online
            ? tr("estates.online")
            : tr("estates.offline")}
      </Badge>
      {props.onLend && !props.lentHere && (
        <Button
          variant="minimal"
          size="sm"
          disabled={props.busy}
          onClick={() => props.onLend?.(estate)}
          data-testid="home-estate-lend"
        >
          <Link2 className="size-4" />
          {tr("estates.home.lend")}
        </Button>
      )}
    </CardContent>
  );
};

export default ProjectSettingsHomeEstateRow;
