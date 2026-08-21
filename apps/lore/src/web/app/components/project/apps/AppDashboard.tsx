import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Bug, Eye, Users } from "lucide-react";

import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import { currentSigilInsightsAtom } from "../../../atoms/currentSigilInsightsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * The app's front page: what it is, and — when Beacon is on — the three numbers
 * that say whether it is healthy, each of which has a tab behind it.
 *
 * With Beacon off there is nothing to count, so the page is the credential card
 * alone plus a line saying where the switch is. An app you enrolled is still an
 * app; refusing to render it because analytics are off would make the whole
 * section vanish for anyone who only wanted crash reports.
 */
const AppDashboard = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const [sigil] = useStore(currentSigilAtom);
  const [insights] = useStore(currentSigilInsightsAtom);

  if (!sigil) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {insights ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                <Users className="size-4" />
                {tr("insights.uniqueVisitors")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {insights.uniqueVisitors.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                <Eye className="size-4" />
                {tr("insights.totalViews")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {insights.totalViews.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                <Bug className="size-4" />
                {tr("app.dashboard.errors")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {insights.errorGroups.length.toLocaleString()}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {tr("app.dashboard.beaconOff")}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {tr("app.dashboard.credential")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">
              {tr("app.dashboard.token")}
            </span>
            <code className="font-mono text-xs">{sigil.tokenPrefix}…</code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">
              {tr("app.dashboard.reports")}
            </span>
            {sigil.kinds.length === 0 ? (
              <span className="text-muted-foreground text-xs">—</span>
            ) : (
              sigil.kinds.map((kind) => (
                <Badge key={kind} variant="outline">
                  {kind}
                </Badge>
              ))
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">
              {tr("app.dashboard.enrolled")}
            </span>
            <span>{String(l(sigil.createdAt, { date: "lll" }))}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AppDashboard;
