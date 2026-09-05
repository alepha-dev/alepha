import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import { formatReference } from "../../../shared/element/typedReference.ts";
import LazyQuestView from "../LazyQuestView.tsx";
import type { QuestlineNode } from "./questlineLayout.ts";

export interface QuestlineDialogProps {
  /**
   * The quest on show, or `null` when the dialog is closed.
   */
  node: QuestlineNode<QuestResource> | null;
  onClose: () => void;
  onQuestChange: (quest: QuestResource) => void;
}

/**
 * The quest, opened over the map.
 *
 * It mounts the real `QuestView` in its `card` context, which is the same
 * component the kanban board's sheet uses, so this surface inherits every
 * improvement made there rather than growing a second quest renderer.
 *
 * ### It used to be flanked by its neighbours
 *
 * Two columns of named cards sat outside the panel, one per incoming and
 * outgoing link, faded in 180ms after the dialog landed so they did not fly
 * in with it. They are gone, and with them `nodesById`, `onNavigate`, the
 * `landed` timer and the `overflow-visible` that let them bleed past the
 * panel edge.
 *
 * What they cost was the panel itself. Reserving room for a 216px column on
 * each side meant the dialog capped at `calc(100vw-32rem)` from `xl` up, so
 * the quest got NARROWER exactly as the screen got wider, and at that width
 * `QuestView` had no room to stand its rail beside the body. The links they
 * offered were never unique to them either: the quest's own questline row,
 * rendered inside the panel by `QuestViewQuestline`, carries the same
 * neighbours and stays reachable below `xl`, where the columns were hidden
 * outright.
 *
 * So the dialog is now the full width it can be, and `QuestView` splits
 * body-from-rail on its own once it has the room.
 *
 * ### Why `context="dialog"` and not `card`
 *
 * It mounted as `card` first, which was wrong in four ways at once: a back
 * arrow where a popup wants an X, a lifecycle verb ("Accept the Quest") on a
 * surface you opened to glance at, a title that went nowhere though its page
 * is one click away, and a rail that scrolled off with the body. `QuestView`
 * carries three of the four as its own `dialog` branch, so this file stays
 * a mount point rather than a second quest renderer. The fourth, the close,
 * belongs to `DialogContent` and is left to it.
 */
const QuestlineDialog = (props: QuestlineDialogProps) => {
  const node = props.node;

  return (
    <Dialog
      open={node != null}
      onOpenChange={(open) => !open && props.onClose()}
    >
      {/*
        `overflow-hidden`, not the `overflow-visible` the flanking columns
        needed: nothing is meant to escape the panel now, and the rounded
        corners should clip what fills it. Menus opened inside still escape,
        because Base UI portals them out rather than overflowing.

        `showCloseButton` is left at its default. `DialogContent`'s own close
        is `absolute top-2 right-2` on the popup, which is the corner this
        wants, and it is a `Dialog.Close` so it needs no handler of its own.
        The header inside carried an X for one iteration; it sat at the end of
        the LEFT column, a third of the way across a 1400px panel, which is
        not where anyone reaches for a popup's close. `QuestView` keeps its
        `dialog` branch clear of that corner from both sides: the rail
        reserves it at `lg`, the chips row below `lg`.
      */}
      <DialogContent className="h-[90vh] w-[min(1400px,calc(100vw-4rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
        {node && (
          <>
            <DialogTitle className="sr-only">
              {formatReference("quest", node.quest.shortId)} {node.quest.title}
            </DialogTitle>

            {/*
              `overflow-hidden`, not `overflow-y-auto`: in the `dialog`
              context `QuestView` owns its own scrolling, splitting into a
              scrolling body and a standing rail. A scroll container here
              would scroll the two together and the header would have nothing
              to stick to.
            */}
            <div className="flex min-h-0 overflow-hidden rounded-xl">
              <LazyQuestView
                quest={node.quest}
                context="dialog"
                onClose={props.onClose}
                onQuestChange={props.onQuestChange}
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default QuestlineDialog;
