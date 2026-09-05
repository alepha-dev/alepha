import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";

import type { I18n } from "../../../services/I18n.ts";
import { appUrl, appUrlLabel } from "./appUrl.ts";

/**
 * How long an app may say nothing before the page says so.
 *
 * A day rather than an hour: an app with real but thin traffic can go a few
 * hours between batches without anything being wrong, and a badge that lights
 * up overnight on a low-traffic staging deployment teaches its owner to ignore
 * it.
 */
const SILENT_AFTER_MS = 24 * 60 * 60 * 1000;

export interface AppDashboardIdentityProps {
  instance: AppInstanceResource;
}

/**
 * What this app is: its name, its address, the credential it reports with, and
 * whether it is still reporting.
 *
 * Free to open, and that is the point of the block. It answers "what is this
 * thing and is it alive" from what the page already loaded, with no aggregate
 * query behind any of it.
 */
const AppDashboardIdentity = (props: AppDashboardIdentityProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const dateTime = useInject(DateTimeProvider);
  const { instance } = props;
  const sigil = instance.sigil;

  const url = appUrl(instance);
  const silent =
    sigil?.lastSeenAt !== undefined &&
    dateTime.nowMillis() - new Date(sigil.lastSeenAt).getTime() >
      SILENT_AFTER_MS;

  return (
    <Card data-testid="app-identity">
      <CardHeader>
        <CardTitle className="text-base">
          {instance.app} / {instance.env}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
        <span className="text-muted-foreground">
          {tr("app.dashboard.address")}
        </span>
        {/*
          Text, not a link, and deliberately so: the page header two lines up
          already carries the address as the clickable one, and a second link to
          the same place beside it is a duplicate control rather than a second
          fact. What this row adds is the part the header cannot say - WHERE the
          value came from.

          Two sources, one answer, resolved by `appUrl`: the operator's pin wins
          over the host the app reports from. Absent is a real state and reads
          as one - a Feedback-only app never posts to the ingest, so it has no
          detected host at all, and an app on both an apex and a `www` reports
          whichever served the last batch. Neither is a detection bug to fix;
          they are cases only the operator can settle, on Settings.
        */}
        <span className="flex flex-col gap-0.5">
          {url ? (
            <>
              <span>{appUrlLabel(url)}</span>
              <span className="text-muted-foreground text-xs">
                {instance.url
                  ? tr("app.dashboard.address.pinned")
                  : tr("app.dashboard.address.detected")}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {tr("app.dashboard.address.unknown")}
            </span>
          )}
        </span>

        <span className="text-muted-foreground">
          {tr("app.dashboard.token")}
        </span>
        <code className="font-mono text-xs">
          {sigil ? `${sigil.tokenPrefix}…` : tr("app.dashboard.token.none")}
        </code>

        <span className="text-muted-foreground">
          {tr("app.dashboard.enrolled")}
        </span>
        <span>
          {sigil
            ? String(l(sigil.createdAt, { date: "lll" }))
            : String(l(instance.createdAt, { date: "lll" }))}
        </span>

        <span className="text-muted-foreground">
          {tr("app.dashboard.lastReport")}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {sigil?.lastSeenAt ? (
            String(l(sigil.lastSeenAt, { date: "lll" }))
          ) : (
            <span className="text-muted-foreground">
              {tr("sigils.neverSeen")}
            </span>
          )}
          {silent && (
            <Badge variant="outline" className="text-amber-600">
              {tr("app.dashboard.silent")}
            </Badge>
          )}
        </span>
      </CardContent>
    </Card>
  );
};

export default AppDashboardIdentity;
