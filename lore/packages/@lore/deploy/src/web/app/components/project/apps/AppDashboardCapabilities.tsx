import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  TimeAgo,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { AlertTriangle, Settings2 } from "lucide-react";

import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";

/**
 * One capability, under both of its names.
 *
 * The two halves speak different vocabularies and always have: the reporting
 * package names what it COLLECTS (`views`, `errors`, `vitals`), Lore names what
 * it ACCEPTS (`beacon`, `blights`, `vitals`). Pairing them is the whole reason
 * this card exists - the two were previously unrelated strings on unrelated
 * pages, and "this app is sending vitals and the sink is refusing them" was
 * invisible in both directions.
 */
const CAPABILITIES: Array<{
  /**
   * The key in the app's own reported `trackers` map, or `feedback`, which is
   * a top-level switch on the reported config rather than a tracker (it is a
   * link the sink hands out, not something collected).
   */
  reported: "views" | "errors" | "vitals" | "feedback";
  /**
   * The sigil `kinds` entry that gates it server-side.
   */
  accepted: string;
  labelKey:
    | "app.dashboard.capability.views"
    | "app.dashboard.capability.errors"
    | "app.dashboard.capability.vitals"
    | "app.dashboard.capability.feedback";
}> = [
  {
    reported: "views",
    accepted: "beacon",
    labelKey: "app.dashboard.capability.views",
  },
  {
    reported: "errors",
    accepted: "blights",
    labelKey: "app.dashboard.capability.errors",
  },
  {
    reported: "vitals",
    accepted: "vitals",
    labelKey: "app.dashboard.capability.vitals",
  },
  {
    reported: "feedback",
    accepted: "feedback",
    labelKey: "app.dashboard.capability.feedback",
  },
];

export interface AppDashboardCapabilitiesProps {
  /**
   * The instance's sigil summary, not the row: capabilities are read off
   * `kinds` and `reportedConfig`, and the card has no business holding a
   * credential's other columns.
   */
  sigil: NonNullable<AppInstanceResource["sigil"]>;
  /**
   * Where what the app sends is switched, when Lore deploys this copy: its
   * Settings tab, whose Sigil features section writes the deploy's config.
   * Absent for a copy Lore only hears from, whose sending is decided in its
   * own deploy, out of Lore's reach - and then the card offers no link.
   */
  configureHref?: string;
}

/**
 * What the app says it sends, beside what this sink accepts.
 *
 * Neither column is editable here. What the app sends is switched on its
 * Settings tab when Lore deploys it (the header's Configure link), and what
 * Lore accepts is the sigil's `kinds`. A switch on this card would be one that
 * half-works: the sink cannot change what an app decides, and pretending
 * otherwise is how a reader ends up believing they turned something off.
 *
 * Absent reported state reads as **unknown**, never as off. An older client
 * reports nothing, and an app that has never reported at all has told us
 * nothing either; both are honest states and neither is "this app collects
 * nothing".
 */
const AppDashboardCapabilities = (props: AppDashboardCapabilitiesProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { sigil } = props;
  const config = sigil.reportedConfig;

  /**
   * What the app claims about one capability: `true`, `false`, or unknown.
   *
   * `feedback` sits at the top level of the reported config and the rest live
   * in `trackers`, which mirrors the split in the package itself.
   */
  const reportedState = (key: (typeof CAPABILITIES)[number]["reported"]) => {
    if (!config) return undefined;
    return key === "feedback" ? config.feedback : config.trackers?.[key];
  };

  /**
   * One side's answer as a tag: on in green, off in grey, unknown outlined so
   * it never reads as either.
   */
  const stateTag = (state: boolean | undefined) =>
    state === undefined ? (
      <Badge variant="outline" className="text-muted-foreground">
        {tr("app.dashboard.unknown")}
      </Badge>
    ) : (
      <Badge variant="tint" tone={state ? "success" : "neutral"}>
        {state ? tr("app.dashboard.on") : tr("app.dashboard.off")}
      </Badge>
    );

  const excluded = config?.feedbackButtonExcludedPaths ?? [];

  return (
    <Card data-testid="app-capabilities">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          {tr("app.dashboard.capabilities")}
        </CardTitle>
        {props.configureHref ? (
          <Button
            variant="outlined"
            size="sm"
            nativeButton={false}
            render={<Link href={props.configureHref} />}
            data-testid="app-capabilities-configure"
          >
            <Settings2 className="size-3.5" />
            {tr("app.dashboard.configure")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <table className="w-full">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th className="pb-2 text-start font-normal" />
              <th className="w-28 pb-2 text-start font-normal">
                {tr("app.dashboard.sends")}
              </th>
              <th className="w-28 pb-2 text-start font-normal">
                {tr("app.dashboard.accepts")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {CAPABILITIES.map((capability) => {
              const sends = reportedState(capability.reported);
              const accepts = sigil.kinds.includes(capability.accepted);
              // Only a real disagreement, so unknown never reads as a fault:
              // an app that has told us nothing is not an app contradicting us.
              const disagrees = sends !== undefined && sends !== accepts;

              return (
                <tr key={capability.reported}>
                  <td className="py-2 pe-3">
                    <span className="flex items-center gap-2">
                      {tr(capability.labelKey)}
                      {disagrees && (
                        <AlertTriangle
                          className="size-3.5 text-amber-600"
                          aria-label={tr("app.dashboard.mismatch")}
                        />
                      )}
                    </span>
                    {/*
                      The button's corner belongs to the feedback row, not to
                      a footnote under the table.
                    */}
                    {capability.reported === "feedback" && config?.feedback ? (
                      <span className="text-muted-foreground block text-xs">
                        {tr("app.dashboard.feedbackButton", {
                          args: [config.feedbackButton ?? "?"],
                        })}
                        {excluded.length > 0
                          ? ` - ${tr("app.dashboard.excludedPaths", {
                              args: [excluded.join(", ")],
                            })}`
                          : ""}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2">{stateTag(sends)}</td>
                  <td className="py-2">{stateTag(accepts)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {sigil.kinds.length === 0 && (
          <Badge variant="outline" className="w-fit">
            {tr("app.dashboard.acceptsNothing")}
          </Badge>
        )}

        {/*
          The timestamp is the whole reason the reported side is trustworthy at
          all: a config reported three weeks ago by an app redeployed since is
          stale, while the app itself is perfectly alive. Its own stamp, not
          `lastSeenAt`.
        */}
        <p className="text-muted-foreground text-xs">
          {config && sigil.reportedConfigAt ? (
            <>
              {tr("app.dashboard.reported")}{" "}
              <TimeAgo value={sigil.reportedConfigAt} />
            </>
          ) : (
            tr("app.dashboard.neverReported")
          )}
        </p>
      </CardContent>
    </Card>
  );
};

export default AppDashboardCapabilities;
