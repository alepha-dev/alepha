import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@alepha/ui";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouterState } from "alepha/react/router";

import { kanbanReloadAtom } from "../../../atoms/kanbanReloadAtom.ts";
import type { ProjectCreateDialogProps } from "../../../registries/ProjectShellRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";
import QuestCreate from "./QuestCreate.tsx";

/**
 * New quest, from the header's "+" menu (registered by `WorkShell`, #E75,
 * #Q2624).
 */
const QuestCreateMenuSheet = (props: ProjectCreateDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [reloadKey, setReloadKey] = useStore(kanbanReloadAtom);
  const routerState = useRouterState();
  // Kanban is its own route again, so this is just the route name. It used
  // to be `projectQuests` plus the stored view, because the board was a mode
  // of the Quests page rather than a place.
  const onKanban = routerState.name === "projectKanban";

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[50vw]"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>{tr("project.menu.create-quest")}</SheetTitle>
        </SheetHeader>
        <QuestCreate
          project={props.project}
          onSubmit={() => props.onOpenChange(false)}
          onCreated={
            onKanban
              ? () => {
                  props.onOpenChange(false);
                  setReloadKey({ key: (reloadKey?.key ?? 0) + 1 });
                }
              : undefined
          }
        />
      </SheetContent>
    </Sheet>
  );
};

export default QuestCreateMenuSheet;
