import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { ProjectHostTableRow } from "./projectHostTableRow.ts";

export interface ProjectSettingsHostNameCellProps {
  row: ProjectHostTableRow;
  /**
   * Opens a home `cloudflare` host's drawer: it has no console page.
   */
  onOpen: (row: ProjectHostTableRow) => void;
}

/**
 * The host's name, and where it leads (feedback #P2126).
 *
 * A `bay` host opens its console, a page under its HOME project (#E126).
 * That project answers 403 to anybody who is not a member there, so a
 * borrowed host is a link only when `can` says the reader may read it:
 * otherwise a link would promise a page they cannot open. A home
 * `cloudflare` host opens its drawer; a borrowed one is plain text.
 */
const ProjectSettingsHostNameCell = (
  props: ProjectSettingsHostNameCellProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const { owned, loan } = props.row;
  const type = owned?.type ?? loan?.type;
  const label = owned?.label ?? loan?.label;
  const homeSlug =
    props.row.origin === "home"
      ? owned?.project?.slug
      : loan?.can.includes("host:read")
        ? loan.home?.slug
        : undefined;

  const name =
    type === "bay" && homeSlug ? (
      // ⚠️ `projectSlug` explicitly: the router does not carry it over from
      // this settings page, and a link without it renders the literal
      // `:projectSlug` and goes nowhere.
      <Link
        href={router.path("bay", {
          params: { projectSlug: homeSlug, hostSlug: props.row.slug },
        })}
        className="truncate hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        {props.row.slug}
      </Link>
    ) : props.row.origin === "home" ? (
      <button
        type="button"
        className="truncate hover:underline"
        onClick={() => props.onOpen(props.row)}
        data-testid="home-host-open"
      >
        {props.row.slug}
      </button>
    ) : (
      <span className="truncate">{props.row.slug}</span>
    );

  // Who else deploys onto a home host: its home project counts only when
  // the host is lent to it.
  const elsewhere = owned
    ? owned.projects.length - (props.row.loan ? 1 : 0)
    : 0;

  return (
    <div
      className="flex min-w-0 flex-col gap-0.5"
      data-testid={props.row.origin === "home" ? "home-host-row" : "host-row"}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {name}
        {label && (
          <span className="text-muted-foreground truncate text-xs font-normal">
            {label}
          </span>
        )}
      </span>
      {elsewhere > 0 && (
        <span className="text-muted-foreground text-xs">
          {tr("hosts.home.lentTo", { args: [String(elsewhere)] })}
        </span>
      )}
    </div>
  );
};

export default ProjectSettingsHostNameCell;
