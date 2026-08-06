import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Bug } from "lucide-react";
import { currentSigilInsightsAtom } from "../../../atoms/currentSigilInsightsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * This app's error budget — the "Errors" tab of the app page.
 *
 * One row per `(app, fingerprint)` still seen in the window, worst first. This
 * is the only surface that keeps failures split by app: the Blights inbox folds
 * every enrolled app into one row per project on purpose, because a triage
 * decision must not fork, and that is exactly what makes it unable to answer
 * "is this still happening *over there*". The App column is kept even though
 * every row now names the same app: it is the only thing on screen that shows
 * the `?sigilId=` narrowing actually happened, and a table that silently widened
 * to the whole project would otherwise look exactly like this one.
 *
 * Reads `currentSigilInsightsAtom` — see the note on `AppAnalytics`.
 *
 * ⚠️ SECURITY: `name` and `message` come out of an application's runtime and
 * are 100% attacker-controlled. They are rendered ONLY through plain React text
 * interpolation, which escapes them. Never MarkdownView, never
 * `dangerouslySetInnerHTML`.
 */
const AppErrors = () => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const [data] = useStore(currentSigilInsightsAtom);

  if (!data) {
    return null;
  }

  const groups = data.errorGroups;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Bug className="size-4" />
        <span>{tr("insights.errors.title")}</span>
        <span className="text-xs">· {tr("insights.errors.subtitle")}</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {tr("insights.errors.heading")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {tr("insights.errors.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-2 pr-3 font-medium">
                      {tr("insights.errors.col.error")}
                    </th>
                    <th className="py-2 pr-3 font-medium">
                      {tr("insights.errors.col.app")}
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">
                      {tr("insights.errors.col.count")}
                    </th>
                    <th className="py-2 pr-3 font-medium">
                      {tr("insights.errors.col.firstSeen")}
                    </th>
                    <th className="py-2 font-medium">
                      {tr("insights.errors.col.lastSeen")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr
                      key={`${group.sigilId}:${group.fingerprint}`}
                      /*
                        Marks the row as a row. The app's name is also in the
                        breadcrumb, the sidebar and the page header, so a
                        page-wide `getByText(name)` proves nothing about this
                        table — a test has to scope to the row.
                      */
                      data-testid="error-group-row"
                      className="border-b last:border-0"
                    >
                      <td className="max-w-[420px] py-2 pr-3">
                        <div className="truncate font-medium">{group.name}</div>
                        <div
                          className="text-muted-foreground truncate text-xs"
                          title={group.message}
                        >
                          {group.message}
                        </div>
                        <div className="text-muted-foreground/70 font-mono text-[10px]">
                          {group.fingerprint.slice(0, 12)}…
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline">{group.sigilLabel}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {group.count.toLocaleString()}
                      </td>
                      <td className="text-muted-foreground py-2 pr-3 whitespace-nowrap">
                        {dt.of(group.firstSeenAt).fromNow()}
                      </td>
                      <td className="text-muted-foreground py-2 whitespace-nowrap">
                        {dt.of(group.lastSeenAt).fromNow()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AppErrors;
