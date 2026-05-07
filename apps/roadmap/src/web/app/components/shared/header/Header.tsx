import { Button } from "@alepha/ui/components/ui/button";
import { useRouter } from "alepha/react/router";
import type { AppRouter } from "../../../AppRouter.ts";
import HeaderCampaignActions from "../../campaign/CampaignActions.tsx";
import RoadmapLogo from "../RoadmapLogo.tsx";
import HeaderActions from "./HeaderActions.tsx";
import HeaderCampaign from "./HeaderCampaign.tsx";
import HeaderMobileQuestLog from "./HeaderMobileQuestLog.tsx";

const Header = () => {
  const router = useRouter<AppRouter>();

  return (
    <div className="flex h-16 w-full items-center gap-2 px-4 py-2">
      <div className="flex items-center justify-center gap-2">
        <HeaderMobileQuestLog />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push(router.path("home"))}
          aria-label="Home"
        >
          <RoadmapLogo />
        </Button>
        <HeaderCampaign />
      </div>
      <div className="hidden flex-1 items-center justify-center px-2 lg:flex">
        <div className="w-full max-w-[900px]">
          <HeaderCampaignActions />
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <HeaderActions />
      </div>
    </div>
  );
};

export default Header;
