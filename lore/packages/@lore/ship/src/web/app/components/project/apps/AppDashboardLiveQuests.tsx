import { Card, CardContent, CardHeader, CardTitle } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import QuestNumberLinks from "./QuestNumberLinks.tsx";
import { useInstanceLiveQuests } from "./useInstanceLiveQuests.ts";

export interface AppDashboardLiveQuestsProps {
  instance: AppInstanceResource;
}

/**
 * The quests this copy runs, and the done ones it does not run yet (#E154).
 *
 * "Not deployed" is the project's completed quests with at least one
 * recorded commit, minus the live set (review answer 3). ⚠️ An unknown or
 * partial set says why rather than a count: a copy deployed before Lore
 * recorded commits, or from a shallow clone, cannot say what it lacks.
 * Renders nothing for a copy that never deployed.
 */
const AppDashboardLiveQuests = (props: AppDashboardLiveQuestsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const live = useInstanceLiveQuests(props.instance.id);

  if (!live || live.reason === "never-deployed") {
    return null;
  }

  return (
    <Card data-testid="app-live-quests">
      <CardHeader>
        <CardTitle className="text-base">{tr("apps.live.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {live.state === "known" && live.behind ? (
          <div className="flex flex-col gap-1">
            <span className="font-medium" data-testid="app-live-behind">
              {tr("apps.live.behind", { args: [String(live.behind.length)] })}
            </span>
            <QuestNumberLinks numbers={live.behind} />
          </div>
        ) : (
          <span
            className="text-muted-foreground"
            data-testid="app-live-unknown"
          >
            {live.state === "known"
              ? tr("apps.live.upToDate")
              : live.reason === "no-commit"
                ? tr("apps.live.unknown.noCommit")
                : live.reason === "partial"
                  ? tr("apps.live.unknown.partial")
                  : tr("apps.live.unknown.noSet")}
          </span>
        )}
        {live.live?.length ? (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">
              {live.dirty
                ? tr("apps.live.runsUnverified", {
                    args: [String(live.live.length)],
                  })
                : tr("apps.live.runs", { args: [String(live.live.length)] })}
            </span>
            <QuestNumberLinks numbers={live.live.toReversed()} />
          </div>
        ) : undefined}
      </CardContent>
    </Card>
  );
};

export default AppDashboardLiveQuests;
