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
      {/* A borderless pen with a tooltip (feedback #P2175), reversing the
          labelled full-size form this used to carry.

          ⚠️ **That form was defended here, and the defence was checked
          against the running page before it was dropped.** It read: a 28px
          icon-only ghost button "read as a hint next to the lifecycle button
          rather than its peer". That objection was about the PAIR, so the
          pair was measured on the quest header - Edit 32x32, Agent Prompts
          32x32, and the lifecycle button (Accept/Complete/Unhold, all
          `size="default"`) 158.71x32. **The same height**, since `size-8`
          and `h-8` are one number: what separates them is width and weight,
          never scale, and "hint" was about the old 28px square sitting a
          notch below the row it was in. Edit is deliberately the quieter of
          the two now - editing a quest is not the same kind of act as taking
          or completing one - and the owner has ruled it should not look like
          it.

          The tooltip is not a reversal, it dissolves. #P2003 removed it
          because it said "Edit" beside a button already saying "Edit"; with
          no visible label there is nothing left to duplicate, and `title` is
          the only thing naming this to a pointer. `aria-label` was always
          here and stays: it is what names it to a reader, at every width. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={tr("quest.view.edit")}
        title={String(tr("quest.view.edit"))}
        onClick={() => setShowDialog(true)}
      >
        <Pencil className="size-4" />
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
