import { useI18n } from "alepha/react/i18n";
import { Bug, Inbox, Layers, Swords } from "lucide-react";

import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import type { I18n } from "../../services/I18n.ts";
import {
  capabilityOption,
  hasCapability,
} from "../../services/projectCapabilities.ts";
import type { HomeOpenLink } from "./HomeOpenLinks.tsx";

/**
 * The Open buttons of one project: quests, epics, blights and feedback, each
 * only when the project has that feature on, the same switches that put the
 * entry in its sidebar. A feature that is off has nothing to count, and a "0"
 * for it would read as "all done" instead.
 *
 * The quest count comes with the project (`openQuestCount`), the others with
 * the board, so until the board arrives those three read 0.
 */
export const useHomeOpenTags = (
  openCounts: Map<number, { epics: number; blights: number; feedback: number }>,
) => {
  const { tr } = useI18n<I18n, "en">();

  return (project: ProjectOverviewResource): HomeOpenLink[] => {
    const counts = openCounts.get(project.id);
    const tags: HomeOpenLink[] = [];
    if (hasCapability(project, "work")) {
      tags.push({
        kind: "quests",
        route: "projectQuests",
        icon: Swords,
        count: project.openQuestCount,
        label: tr("home.table.open.quests", {
          args: [String(project.openQuestCount)],
        }),
      });
    }
    if (capabilityOption(project, "work", "epics")) {
      const count = counts?.epics ?? 0;
      tags.push({
        kind: "epics",
        route: "projectEpics",
        icon: Layers,
        count,
        label: tr("home.table.open.epics", { args: [String(count)] }),
      });
    }
    if (capabilityOption(project, "apps", "track")) {
      const count = counts?.blights ?? 0;
      tags.push({
        kind: "blights",
        route: "projectBlights",
        icon: Bug,
        count,
        label: tr("home.table.open.blights", { args: [String(count)] }),
      });
    }
    if (hasCapability(project, "support")) {
      const count = counts?.feedback ?? 0;
      tags.push({
        kind: "feedback",
        route: "projectFeedback",
        icon: Inbox,
        count,
        label: tr("home.table.open.feedback", { args: [String(count)] }),
      });
    }
    return tags;
  };
};
