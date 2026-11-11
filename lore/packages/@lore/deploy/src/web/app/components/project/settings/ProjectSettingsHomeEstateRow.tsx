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
  /**
   * Opens a `cloudflare` estate's drawer: it has no console, so its
   * settings live behind its row.
   */
  onOpen: (estate: OwnedEstateResource) => void;
  busy: boolean;
}

/**
 * One estate this project is the home of: its members manage it, each by
 * their rank. The slug opens its console (a `bay` estate) or its drawer (a
 * `cloudflare` one), which every member of the home can read.
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
          {estate.type === "bay" && estate.project?.slug ? (
            // ⚠️ `projectSlug` explicitly: the router does not carry it over
            // from this settings page, and a link without it renders the
            // literal `:projectSlug` and goes nowhere.
            <Link
              href={router.path("bay", {
                params: {
                  projectSlug: estate.project.slug,
                  estateSlug: estate.slug,
                },
              })}
              className="truncate hover:underline"
            >
              {estate.slug}
            </Link>
          ) : (
            <button
              type="button"
              className="truncate hover:underline"
              onClick={() => props.onOpen(estate)}
              data-testid="home-estate-open"
            >
              {estate.slug}
            </button>
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
      {estate.providerServerId ? (
        // Bought by `lore estate provision` (#Q3168): the console shows its
        // price and what it has cost.
        <Badge variant="outline" data-testid="home-estate-provisioned">
          {tr("estates.provisioned", {
            args: [estate.provider ?? "", estate.providerServerType ?? ""],
          })}
        </Badge>
      ) : null}
      {estate.overdue ? (
        // Past the TTL it was given (#Q3138): still running, still billing,
        // until somebody deletes it.
        <Badge variant="destructive" data-testid="home-estate-overdue">
          {tr("estates.overdue")}
        </Badge>
      ) : null}
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
