import { useClient, useStore } from "alepha/react";
import { NestedView, useRouterState } from "alepha/react/router";
import { useEffect } from "react";
import type { PetitionController } from "@/api/controllers/PetitionController.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { currentPetitionCountAtom } from "../../atoms/currentPetitionCountAtom.ts";
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
  "campaignFolios",
  "campaignFoliosNew",
  "campaignFoliosFolio",
  "campaignFoliosFolioEdit",
]);

const PETITION_POLL_INTERVAL_MS = 30_000;

const CampaignView = () => {
  const routerState = useRouterState();
  const name = routerState.name ?? "";
  const showQuestLog = ROUTES_WITH_QUEST_LOG.has(name);
  const fullWidth = ROUTES_FULL_WIDTH.has(name);

  const [campaign] = useStore(currentCampaignAtom);
  const [, setPetitionCount] = useStore(currentPetitionCountAtom);
  const setCount = (n: number) => setPetitionCount({ count: n });
  const petitionApi = useClient<PetitionController>();

  /**
   * Piggyback poll on `petitionApi.list` for the inbox badge. Skips when the
   * tab is hidden (mirrors the DevTools polling pattern) and silently
   * ignores errors — polling failures simply leave the count at 0.
   */
  useEffect(() => {
    if (!campaign) {
      setCount(0);
      return;
    }

    const campaignId = campaign.id;
    let cancelled = false;

    const refresh = async () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      try {
        const { items } = await petitionApi.listPetitions({
          params: { campaignId },
          query: { status: "pending" },
        });
        if (!cancelled) {
          setCount(items.length);
        }
      } catch {
        // silently ignore — petitions polling may have failed on this campaign
      }
    };

    refresh();
    const handle = window.setInterval(refresh, PETITION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
      setCount(0);
    };
  }, [campaign?.id]);

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
