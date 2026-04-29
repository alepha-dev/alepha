import { Button } from "@alepha/ui/components/ui/button";
import { useRouter } from "alepha/react/router";
import type { AppRouter } from "../../../AppRouter.ts";
import HeaderProjectActions from "../../project/ProjectActions.tsx";
import RoadmapLogo from "../RoadmapLogo.tsx";
import HeaderActions from "./HeaderActions.tsx";
import HeaderKanbanCreateButton from "./HeaderKanbanCreateButton.tsx";
import HeaderMobileQuestLog from "./HeaderMobileQuestLog.tsx";
import HeaderProject from "./HeaderProject.tsx";

const Header = () => {
  const router = useRouter<AppRouter>();

  return (
    <div className="flex h-16 items-center justify-center px-4 py-2">
      <div className="mx-auto flex w-full max-w-[1200px] items-center gap-2">
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
          <HeaderProject />
        </div>
        <div className="hidden flex-1 items-center justify-center px-2 lg:flex">
          <div className="w-full max-w-[900px]">
            <HeaderProjectActions />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <HeaderKanbanCreateButton />
          <HeaderActions />
        </div>
      </div>
    </div>
  );
};

export default Header;
