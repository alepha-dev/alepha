import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Pencil } from "lucide-react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import QuestCreate from "./QuestCreate.tsx";

export interface QuestViewEditButtonProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
  showDialog?: boolean;
  setShowDialog?: (show: boolean) => void;
}

const QuestViewEditButton = (props: QuestViewEditButtonProps) => {
  const showDialog = props.showDialog ?? false;
  const setShowDialog = props.setShowDialog ?? (() => {});

  const client = useClient<QuestController>();
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);

  if (!project) return null;
  if (!client.updateQuestById.can()) return null;

  return (
    <>
      {/* Labelled and full size, per the mockup. It was a 28px icon-only
          ghost button, which read as a hint next to the lifecycle button
          rather than its peer. The label hides on narrow screens, the same
          way the lifecycle button's does, so the pair shrinks together.

          No tooltip. It said "Edit" beside a button that says "Edit", which
          adds nothing and delays the click (feedback #2003). Below `sm` the
          label is hidden, but that is a touch width, where a hover tooltip
          never fires anyway - and `aria-label` is what names the button in
          every case. */}
      <Button
        type="button"
        variant="outline"
        aria-label={tr("quest.view.edit")}
        onClick={() => setShowDialog(true)}
      >
        <Pencil className="size-4" />
        <span className="hidden sm:inline">{tr("quest.view.edit")}</span>
      </Button>

      <Sheet open={showDialog} onOpenChange={setShowDialog}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[50vw]"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{tr("quest.create.update")}</SheetTitle>
          </SheetHeader>
          <QuestCreate
            project={project}
            quest={props.quest}
            onSubmit={(quest) => {
              setShowDialog(false);
              props.onUpdate(quest);
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
};

export default QuestViewEditButton;
