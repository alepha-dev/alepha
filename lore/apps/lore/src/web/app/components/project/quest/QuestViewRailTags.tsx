import { Badge } from "@alepha/ui";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Tags as TagsIcon } from "lucide-react";

import type { PaletteColor } from "@/api/schemas/paletteColorSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import {
  TAG_CHIP_CLASS,
  TAG_CHIP_FALLBACK,
} from "@/web/app/components/shared/areaColor.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

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
    // `pt-2.5`, not the `pt-4` of the blocks below: the row brings its own
    // `py-1.5`, and the two add up to the same gap under the rule.
    <div className="border-t pt-2.5">
      {/* A rail row like the ones above, label left and chips right (#Q2424).
          It was a label over a line of chips, the one block in the rail laid
          out differently. */}
      <QuestViewRailRow icon={TagsIcon} label={tr("quest.create.tags")}>
        <span className="flex flex-wrap justify-end gap-1">
          {tags.map((tag) => (
            // The project's tag colour, the same chip the board renders. It
            // used to be a plain outline here and a tinted span there, so the
            // colour the owner picked was visible on one surface only (#1638).
            //
            // `h-4 py-0`: the text height of the rail, so a row of chips is
            // as tall as a row of text. The badge's own `h-5` made this the
            // one row that stood out.
            <Badge
              key={tag}
              variant="tint"
              className={`h-4 px-1.5 py-0 font-mono text-[11px] leading-none ${
                TAG_CHIP_CLASS[project?.tagColors?.[tag] as PaletteColor] ??
                TAG_CHIP_FALLBACK
              }`}
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
