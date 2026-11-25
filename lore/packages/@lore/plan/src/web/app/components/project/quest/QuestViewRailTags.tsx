import { Badge } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Tags as TagsIcon, X } from "lucide-react";

import type { QuestController } from "../../../../../api/controllers/QuestController.ts";
import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";
import { tagTone } from "../../shared/areaColor.ts";
import QuestViewRailRow from "./QuestViewRailRow.tsx";

export interface QuestViewRailTagsProps {
  quest: QuestResource;
  /**
   * The quest as the server answered a tag's removal.
   */
  onUpdate: (quest: QuestResource) => void;
}

/**
 * The rail's tags block: monospace chips, each removable from the rail.
 *
 * **Removing is the rail's, adding is the drawer's** (#Q4285, at the owner's
 * request). Hovering or focusing a chip shows an "x" drawn over its own
 * text, absolutely positioned, so neither the chip's width nor the row's
 * wrapping moves; a click removes the tag at once. The server takes `tags`
 * on a completed quest too, so this works whatever the status.
 *
 * Adding stays in the edit drawer alone. The rail used to carry an inline
 * `+ tag` that swapped in the create form's chip input, which put a second,
 * differently-shaped editor on a surface whose job is to be read. A removal
 * is one click on what is already there, and needs no editor.
 */
const QuestViewRailTags = (props: QuestViewRailTagsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const questApi = useClient<QuestController>();
  const [project] = useStore(currentProjectAtom);
  const tags = props.quest.tags ?? [];
  const canUpdate = questApi.updateQuestById.can();

  // A refusal reaches the root `ActionErrorToaster`, and the chip stays:
  // only the server's answer changes the quest.
  const remove = useAction<[tag: string], void>(
    {
      handler: async (_ctx, tag) => {
        const updated = await questApi.updateQuestById({
          params: { id: props.quest.id },
          body: { tags: tags.filter((it) => it !== tag) },
        });
        props.onUpdate(updated);
      },
    },
    [questApi, props.quest.id, tags.join(",")],
  );

  if (tags.length === 0) {
    return null;
  }

  return (
    // Ruled off from the metadata rows above, matching Reminder and the
    // action rows below. The border lives here rather than on a wrapper at
    // the call site because this returns `null` when the quest has no tags,
    // and a wrapper would leave the separator behind with nothing under it.
    //
    // No top padding: the row brings its own `py-1.5`, so the tags sit
    // under the rule like any other rail row.
    <div className="border-t">
      {/* A rail row like the ones above, label left and chips right (#Q2424).
          It was a label over a line of chips, the one block in the rail laid
          out differently. */}
      <QuestViewRailRow icon={TagsIcon} label={tr("quest.create.tags")}>
        {/* `-my-0.5`: the chips are the standard 20px tint badge, 4px taller
            than the rail's 16px line. They reach 2px into the row's own
            padding on each side, so the Tags row stays the height of every
            other row instead of growing to fit them. */}
        <span className="-my-0.5 flex flex-wrap justify-end gap-1">
          {tags.map((tag) => (
            // The project's tag colour, the same chip the board renders. It
            // used to be a plain outline here and a tinted span there, so the
            // colour the owner picked was visible on one surface only (#1638).
            <Badge
              key={tag}
              variant="tint"
              tone={tagTone(project?.tagColors?.[tag])}
              className="group/tag relative"
              data-testid="quest-rail-tag"
            >
              {tag}
              {canUpdate && (
                // Over the chip's own text, never beside it: shown on hover
                // or focus, it changes no width and no wrapping.
                <button
                  type="button"
                  aria-label={tr("quest.rail.tags.remove", { args: [tag] })}
                  disabled={remove.loading}
                  onClick={() => void remove.run(tag)}
                  className="bg-card/90 text-foreground absolute inset-0 flex items-center justify-center rounded-[inherit] opacity-0 transition-opacity group-hover/tag:opacity-100 focus-visible:opacity-100 disabled:cursor-wait"
                  data-testid="quest-rail-tag-remove"
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </span>
      </QuestViewRailRow>
    </div>
  );
};

export default QuestViewRailTags;
