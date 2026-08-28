import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { PaletteColor } from "@/api/schemas/paletteColorSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { TAG_CHIP_CLASS, TAG_CHIP_FALLBACK } from "../../shared/areaColor.ts";

/**
 * The palette, in the order the swatch row offers it. `undefined` is the
 * first entry: clearing a tag's colour has to be as reachable as setting
 * one, and it is what "no opinion" looks like on the board.
 */
const CHOICES: Array<PaletteColor | undefined> = [
  undefined,
  "slate",
  "blue",
  "green",
  "amber",
  "red",
  "violet",
  "cyan",
  "pink",
];

/**
 * Assigns a palette colour to each quest tag the project uses.
 *
 * The tag list comes from `listQuestTags` — the same endpoint the board's
 * tag filter reads — because tags have no table of their own: they are a
 * denormalized `string[]` on `quests`, so the only way to know which exist
 * is to ask what is in use. A tag that stops being used keeps its entry in
 * `project.tagColors` and simply stops being offered here; the entry is
 * inert rather than wrong, and returns with the tag.
 */
const ProjectSettingsTagColors = () => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const toaster = useToast();
  const projectApi = useClient<ProjectController>();
  const questApi = useClient<QuestController>();
  const [project] = useStore(currentProjectAtom);
  const [tags, setTags] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!project?.id) return;
    questApi
      .listQuestTags({ query: { projectId: project.id } })
      .then(setTags)
      .catch(() => null);
  }, [project?.id]);

  if (!project) return null;

  const colors = project.tagColors ?? {};

  const setColor = async (tag: string, color: PaletteColor | undefined) => {
    setPending(tag);
    // The whole map goes over the wire, not a patch: deleting a key is how
    // a colour is cleared, and a merge on the server has no way to express
    // that without inventing a "none" token.
    const next: Record<string, PaletteColor> = { ...colors };
    if (color) {
      next[tag] = color;
    } else {
      delete next[tag];
    }
    try {
      const updated = await projectApi.updateProjectById({
        params: { id: project.id },
        body: { tagColors: next },
      });
      alepha.store.set(currentProjectAtom, updated);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          {tr("project.settings.kanban.tagColors.title")}
        </span>
        <span className="text-muted-foreground text-xs">
          {tr("project.settings.kanban.tagColors.description")}
        </span>
      </div>

      {tags.length === 0 ? (
        <span className="text-muted-foreground text-xs">
          {tr("project.settings.kanban.tagColors.empty")}
        </span>
      ) : (
        <div className="flex flex-col gap-2">
          {tags.map((tag) => (
            <div
              key={tag}
              data-testid="tag-color-row"
              data-tag={tag}
              className="flex flex-wrap items-center gap-2"
            >
              <span
                className={`w-28 shrink-0 truncate rounded px-1.5 py-0.5 text-xs font-medium ${
                  TAG_CHIP_CLASS[colors[tag] as PaletteColor] ??
                  TAG_CHIP_FALLBACK
                }`}
              >
                {tag}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                {CHOICES.map((choice) => (
                  <button
                    key={choice ?? "none"}
                    type="button"
                    disabled={pending === tag}
                    aria-label={choice ?? tr("common.none")}
                    aria-pressed={colors[tag] === choice}
                    data-color={choice ?? "none"}
                    onClick={() => void setColor(tag, choice)}
                    className={`size-5 rounded-full border transition-transform ${
                      colors[tag] === choice
                        ? "border-foreground scale-110"
                        : "border-border"
                    } ${
                      choice
                        ? SWATCH_CLASS[choice]
                        : "bg-muted text-muted-foreground"
                    }`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * The swatch fill, one literal per token — Tailwind scans source text, so a
 * computed `bg-${token}-400` compiles to nothing.
 */
const SWATCH_CLASS: Record<PaletteColor, string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-400",
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  red: "bg-red-400",
  violet: "bg-violet-400",
  cyan: "bg-cyan-400",
  pink: "bg-pink-400",
};

export default ProjectSettingsTagColors;
