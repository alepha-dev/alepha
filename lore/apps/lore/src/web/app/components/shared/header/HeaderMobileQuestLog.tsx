import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@alepha/ui/components/ui/sheet";
import { useEvents, useStore } from "alepha/react";
import { Menu } from "lucide-react";
import { useState } from "react";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import QuestLog from "../../campaign/QuestLog.tsx";

export type HeaderMobileQuestLogProps = {};

const HeaderMobileQuestLog = (_props: HeaderMobileQuestLogProps) => {
  const [show, setShow] = useState(false);
  const [campaign] = useStore(currentCampaignAtom);

  useEvents(
    {
      "react:transition:end": () => setShow(false),
    },
    [],
  );

  if (!campaign) {
    return null;
  }

  return (
    <div className="flex lg:hidden">
      <Sheet open={show} onOpenChange={setShow}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Quest log">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="border-border w-80 overflow-y-auto border-r p-0"
        >
          <QuestLog />
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default HeaderMobileQuestLog;
