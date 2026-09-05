import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";
import { AlertTriangle } from "lucide-react";
import { Fragment } from "react";

import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";

import type { I18n } from "../../../services/I18n.ts";

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
}

/**
 * What the app says it sends, beside what this sink accepts.
 *
 * Neither column is editable. `kinds` is changed on Settings; the reported side
 * is changed in the app's own `SIGIL_CONFIG`, in its deploy, and offering a
 * switch here would be offering one that half-works: the sink cannot change
 * what an app decides, and pretending otherwise is how a reader ends up
 * believing they turned something off.
 *
 * Absent reported state reads as **unknown**, never as off. An older client
 * reports nothing, and an app that has never reported at all has told us
 * nothing either; both are honest states and neither is "this app collects
 * nothing".
 */
const AppDashboardCapabilities = (props: AppDashboardCapabilitiesProps) => {
  const { tr, l } = useI18n<I18n, "en">();
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

  return (
    <Card data-testid="app-capabilities">
      <CardHeader>
        <CardTitle className="text-base">
          {tr("app.dashboard.capabilities")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-6 gap-y-2">
          <span />
          <span className="text-muted-foreground text-xs tracking-wide uppercase">
            {tr("app.dashboard.sends")}
          </span>
          <span className="text-muted-foreground text-xs tracking-wide uppercase">
            {tr("app.dashboard.accepts")}
          </span>

          {CAPABILITIES.map((capability) => {
            const sends = reportedState(capability.reported);
            const accepts = sigil.kinds.includes(capability.accepted);
            // Only a real disagreement, so unknown never reads as a fault: an
            // app that has told us nothing is not an app contradicting us.
            const disagrees = sends !== undefined && sends !== accepts;

            return (
              <Fragment key={capability.reported}>
                <span className="flex items-center gap-2">
                  {tr(capability.labelKey)}
                  {disagrees && (
                    <AlertTriangle
                      className="size-3.5 text-amber-600"
                      aria-label={tr("app.dashboard.mismatch")}
                    />
                  )}
                </span>
                <span
                  className={
                    sends === undefined ? "text-muted-foreground" : undefined
                  }
                >
                  {sends === undefined
                    ? tr("app.dashboard.unknown")
                    : sends
                      ? tr("app.dashboard.on")
                      : tr("app.dashboard.off")}
                </span>
                <span>
                  {accepts ? tr("app.dashboard.on") : tr("app.dashboard.off")}
                </span>
              </Fragment>
            );
          })}
        </div>

        {config && (
          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            <span>
              {tr("app.dashboard.feedbackButton", {
                args: [config.feedbackButton ?? "?"],
              })}
            </span>
            {(config.feedbackButtonExcludedPaths?.length ?? 0) > 0 && (
              <span>
                {tr("app.dashboard.excludedPaths", {
                  args: [(config.feedbackButtonExcludedPaths ?? []).join(", ")],
                })}
              </span>
            )}
          </div>
        )}

        {/*
          The timestamp is the whole reason the reported side is trustworthy at
          all: a config reported three weeks ago by an app redeployed since is
          stale, while the app itself is perfectly alive. Its own stamp, not
          `lastSeenAt`.
        */}
        <p className="text-muted-foreground text-xs">
          {config && sigil.reportedConfigAt
            ? tr("app.dashboard.reportedAt", {
                args: [String(l(sigil.reportedConfigAt, { date: "lll" }))],
              })
            : tr("app.dashboard.neverReported")}
        </p>

        <p className="text-muted-foreground text-xs">
          {tr("app.dashboard.configHint")}
        </p>

        {sigil.kinds.length === 0 && (
          <Badge variant="outline" className="w-fit">
            {tr("app.dashboard.acceptsNothing")}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
};

export default AppDashboardCapabilities;
