import { NestedView, useRouterState } from "alepha/react/router";
import ExperienceBar from "../misc/ExperienceBar.tsx";
import CampaignActions from "./CampaignActions.tsx";
import QuestLog from "./QuestLog.tsx";

const ROUTES_WITH_QUEST_LOG = new Set([
  "campaignDashboard",
  "campaignBoard",
  "campaignChapters",
  "campaignQuest",
]);

const ROUTES_FULL_WIDTH = new Set([
  "campaignKanban",
  "campaignLore",
  "campaignLoreNew",
  "campaignLoreFolio",
  "campaignLoreFolioEdit",
]);

const CampaignView = () => {
  const routerState = useRouterState();
  const name = routerState.name ?? "";
  const showQuestLog = ROUTES_WITH_QUEST_LOG.has(name);
  const fullWidth = ROUTES_FULL_WIDTH.has(name);

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="bg-card border-border flex flex-1 flex-col overflow-auto border-y">
        <div className="flex w-full flex-1 flex-col gap-2 overflow-auto">
          <div className="flex w-full lg:hidden">
            <CampaignActions />
          </div>
          {showQuestLog ? (
            <div className="flex flex-1 gap-2 overflow-auto p-2">
              <div
                className="hidden shrink-0 lg:flex"
                style={{ width: "25%", minWidth: 240, maxWidth: 420 }}
              >
                <QuestLog />
              </div>
              <div className="flex flex-1 flex-col overflow-auto">
                <NestedView />
              </div>
            </div>
          ) : fullWidth ? (
            <div className="flex w-full flex-1 flex-col overflow-auto">
              <NestedView />
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-auto p-2">
              <NestedView />
            </div>
          )}
        </div>
      </div>
      <ExperienceBar />
    </div>
  );
};

export default CampaignView;
