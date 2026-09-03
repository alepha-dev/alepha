import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Bug } from "lucide-react";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import AppInsightsControls from "./AppInsightsControls.tsx";
import { useAppInsights } from "./useAppInsights.ts";

/**
 * Distinct failures still happening in THIS app, over the selected window.
 *
 * ## Why this is a tab and not a card on Analytics
 *
 * It was a card on Analytics, added by #1215 when three tiles left the app
 * Dashboard so that page would issue no analytics query at all. The owner
 * asked for it off that page (feedback #2080, "remove Blights Card on
 * Analytics page, it's not the right place"), and they are right: an error
 * budget is not a traffic number, and the card was reduced to a bare count
 * with nowhere to go but the project-wide inbox.
 *
 * Deleting it was the other candidate and is what #178 did to the App ▸ Errors
 * tab this restores. #178's reasoning was that at ONE enrolled app the tab
 * duplicated the Blights inbox - and it recorded that "the distinction returns
 * at two". It has: the report came from a second app. The inbox keys on
 * `(project, fingerprint)` so a triage decision does not fork, which merges
 * every enrolled app into one row and makes it structurally unable to answer
 * "is this still happening in that app".
 *
 * The Dashboard was the third candidate and is the one that cannot work
 * cheaply: `errorGroups` is a field of the whole insights payload, not an
 * endpoint of its own, so putting it there would make the Dashboard pay the
 * full analytics query - exactly what #1215 removed, and what
 * `AppDashboard.browser.spec.tsx` guards.
 *
 * ## What it shows that the card did not
 *
 * The payload has carried a name, a message, an occurrence count and both
 * timestamps per group since it existed, and the card rendered `.length`. The
 * data was already there; only the room was missing.
 *
 * ⚠️ `name` and `message` come out of the reporting application's runtime and
 * are attacker-controlled, shown to the project owner. Escaped plain text
 * only - never markdown, never `dangerouslySetInnerHTML`.
 */
const AppErrors = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const { data, loading, range, traffic, setFilters } = useAppInsights();

  const groups = data?.errorGroups ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Bug className="size-4" />
          <span>{tr("insights.errors.title")}</span>
          <span className="text-xs">· {tr("insights.errors.note")}</span>
        </div>
        <AppInsightsControls
          range={range}
          traffic={traffic}
          loading={loading}
          onChange={setFilters}
        />
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            {tr("insights.errors.empty")}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-0 p-0">
            {groups.map((group) => (
              <div
                key={group.fingerprint}
                data-testid="app-error-group"
                className="border-border flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3 last:border-b-0"
              >
                <span className="font-medium">{group.name}</span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                  {group.message}
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {group.count.toLocaleString()}
                </span>
                <span className="text-muted-foreground text-xs">
                  {String(l(group.lastSeenAt, { date: "lll" }))}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Triage stays in the project inbox, deliberately: a blight keys on
          `(project, fingerprint)` precisely so one decision covers every app
          that hit it. This tab answers "is it still happening here"; it does
          not offer a second place to resolve or ignore. */}
      {project && (
        <div className="text-right">
          <Link
            href={router.path("projectBlights", {
              params: { projectSlug: project.slug },
            })}
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            {tr("insights.errors.inbox")}
          </Link>
        </div>
      )}
    </div>
  );
};

export default AppErrors;
