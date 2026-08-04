import { Badge } from "@alepha/ui/components/ui/badge";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Server } from "lucide-react";
import type { OutpostResource } from "@/api/controllers/OutpostController.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface CampaignOutpostsProps {
  items: OutpostResource[];
}

/**
 * How long a machine may stay quiet before it is called out.
 *
 * The report cadence is once a minute, so five minutes is roughly five missed
 * reports: unambiguous without flagging a single dropped request.
 */
const SILENT_AFTER_MS = 5 * 60 * 1000;

/**
 * The machines reporting into this campaign, and whether they still are.
 *
 * Read-only by construction: Lore never reaches a machine, so there is nothing
 * here to press. Enrolment, rotation and deletion all live in campaign
 * settings, because they are credential operations rather than observations.
 *
 * `agent` and `lastSeenAt` are both absent until a machine first reports, so
 * each has an explicit "nothing yet" rendering — a blank cell reads as a bug,
 * and a stale date reads as a lie.
 */
const CampaignOutposts = (props: CampaignOutpostsProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const dateTime = useInject(DateTimeProvider);
  const now = dateTime.nowMillis();

  if (props.items.length === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4 md:pt-10">
        <Card className="bg-card rounded-lg border">
          <CardContent className="px-4">
            <span className="text-muted-foreground text-sm">
              {tr("outposts.page.empty")}
            </span>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:pt-10">
      {props.items.map((outpost) => {
        const seenAt = outpost.lastSeenAt
          ? new Date(outpost.lastSeenAt).getTime()
          : undefined;
        const silent = seenAt !== undefined && now - seenAt > SILENT_AFTER_MS;

        return (
          <Card key={outpost.id} className="bg-card rounded-lg border">
            <CardContent className="flex flex-col gap-3 px-4">
              <div className="flex flex-wrap items-center gap-2">
                <Server className="text-muted-foreground size-4" />
                <span className="truncate text-sm font-medium">
                  {outpost.label}
                </span>
                {silent && (
                  <Badge variant="destructive">
                    {tr("outposts.page.silent")}
                  </Badge>
                )}
                <code className="text-muted-foreground truncate font-mono text-xs">
                  {outpost.tokenPrefix}…
                </code>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground">
                    {tr("outposts.page.agent")}
                  </dt>
                  <dd className="font-mono">
                    {outpost.agent ?? tr("outposts.page.agentUnknown")}
                  </dd>
                </div>
                {outpost.baseDomain && (
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-muted-foreground">
                      {tr("outposts.page.baseDomain")}
                    </dt>
                    <dd className="truncate font-mono">{outpost.baseDomain}</dd>
                  </div>
                )}
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground">
                    {tr("outposts.page.apps")}
                  </dt>
                  <dd>{outpost.appCount}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground">
                    {tr("outposts.page.lastSeen")}
                  </dt>
                  <dd>
                    {outpost.lastSeenAt
                      ? String(l(outpost.lastSeenAt, { date: "lll" }))
                      : tr("outposts.page.neverConnected")}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default CampaignOutposts;
