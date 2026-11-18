import { Badge } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Tags as TagsIcon } from "lucide-react";

import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";
import { tagTone } from "../../shared/areaColor.ts";
import QuestViewRailRow from "./QuestViewRailRow.tsx";

export interface QuestViewRailTagsProps {
  quest: QuestResource;
}

/**
 * The rail's tags block: monospace chips, read-only.
 *
 * Editing lives in the edit drawer alone. The rail used to carry an inline
 * `+ tag` that swapped in the create form's chip input, on the argument that
 * a one-value edit with nothing to validate should not need a round trip.
 * That put a second, differently-shaped editor on a surface whose whole job
 * is to be read, and left the quest with two places to change the same
 * field. One editor, in the drawer.
 */
const QuestViewRailTags = (props: QuestViewRailTagsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const tags = props.quest.tags ?? [];

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
            >
              {tag}
            </Badge>
          ))}
        </span>
      </QuestViewRailRow>
    </div>
  );
};

export default QuestViewRailTags;
