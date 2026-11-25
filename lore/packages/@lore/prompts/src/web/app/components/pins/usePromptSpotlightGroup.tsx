import type {
  I18n,
  SpotlightSourceContext,
  SpotlightSourceGroup,
} from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Copy, Play } from "lucide-react";

import { promptPageAtom } from "../../atoms/promptPageAtom.ts";
import { usePromptPins } from "./usePromptPins.tsx";

/**
 * The spotlight's prompt rows (#Q4284), as a source of core's spotlight
 * (#E175): every prompt of the project, pinned or not, Copy and Run under
 * the robot button's conditions, matched on what the row says. A row fills
 * the item the page published, and opens the Prompts tab's own dialog.
 */
export const usePromptSpotlightGroup = (
  context: SpotlightSourceContext,
): SpotlightSourceGroup => {
  const { tr } = useI18n<I18n, "en">();
  const [promptPage] = useStore(promptPageAtom);
  const pins = usePromptPins({ enabled: context.wanted });
  const q = context.query.trim().toLowerCase();

  const rows = q
    ? pins.prompts.flatMap((prompt) =>
        (["copy", "run"] as const)
          .filter((mode) => mode === "copy" || pins.canRun(prompt))
          .map((mode) => ({
            key: `prompt:${mode}:${prompt.name}`,
            label: tr(`prompts.spotlight.${mode}`, { args: [prompt.title] }),
            icon: mode === "copy" ? <Copy /> : <Play />,
            onSelect: () => pins.start(prompt, mode, promptPage.item),
            name: prompt.name,
          }))
          .filter(
            (row) =>
              row.label.toLowerCase().includes(q) || row.name.includes(q),
          )
          .map(({ name: _name, ...row }) => row),
      )
    : [];

  return {
    heading: tr("spotlight.group.prompts"),
    rows,
    dialog: pins.dialog,
  };
};
