import { Sheet, SheetContent } from "@alepha/ui";
import { useAlepha, useStore } from "alepha/react";
import { useOverlay } from "alepha/react/router";

import type { QuestResource } from "../../../../api/schemas/questResourceSchema.ts";
import { currentQuestAtom } from "../../atoms/currentQuestAtom.ts";
import LazyQuestView from "./quest/LazyQuestView.tsx";

export interface ProjectKanbanCardProps {
  quest: QuestResource;
}

/**
 * One kanban card, open as a sheet over the board: `projectQuest`'s overlay,
 * so the board stays mounted underneath and does not refetch when a card opens
 * or closes, and a reload shows the full quest page.
 *
 * `QuestView` is mounted in its `card` context — the same one the local
 * drawer used, deliberately not a fourth context. The route only changes
 * where the quest comes from (a loader, fresh) and where closing goes (back
 * through history, to the board).
 */
const ProjectKanbanCard = (props: ProjectKanbanCardProps) => {
  const alepha = useAlepha();
  const { close } = useOverlay();
  // The loader seeds this, and `QuestView` writes it on every mutation, so
  // reading it here is what keeps the sheet showing the current version
  // rather than the one the route opened with.
  const [current] = useStore(currentQuestAtom);
  const quest = current ?? props.quest;

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full p-0 data-[side=right]:sm:max-w-[50vw]"
      >
        <LazyQuestView
          quest={quest}
          context="card"
          onClose={close}
          // The board reads `currentQuestAtom` to patch its own row, so a
          // change made here moves the card behind the sheet without either
          // side holding a reference to the other.
          onQuestChange={(updated) => {
            alepha.store.set(currentQuestAtom, updated);
          }}
        />
      </SheetContent>
    </Sheet>
  );
};

export default ProjectKanbanCard;
