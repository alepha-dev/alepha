import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import Questline from "./questline/Questline.tsx";

export interface QuestQuestlineProps {
  /**
   * The quest the route names. Absent only if the component came back
   * without it, which the endpoint makes impossible - the walk starts there.
   */
  quest?: QuestResource;
  /**
   * The connected `dependsOn` component, `quest` included.
   */
  quests: QuestResource[];
}

/**
 * One quest's questline (route `projectQuestGraph`, `/quests/:shortId/graph`).
 *
 * This is the same `Questline` map the epic's Flow tab draws, over a
 * different set of quests: there, an epic's members; here, the `dependsOn`
 * component the focused quest sits in. A quest that belongs to an epic never
 * reaches this component at all - the loader sends it to that epic's Flow
 * tab, which draws the same thing beside the epic's own chrome.
 *
 * It replaced a 450-line page of its own design: a left rail, a
 * PREVIOUS / current / NEXT window and a description panel, over a
 * client-side BFS of an edge list it fetched for the whole project and
 * reloaded every minute. Two surfaces answering one question in two visual
 * languages, and the second one also the surface behind folio #1057's
 * polling incident.
 *
 * The page owns its data - the loader fetched it - and `Questline` fetches
 * nothing. That rule is the point rather than an implementation detail: it
 * is what the retired page broke.
 */
const QuestQuestline = (props: QuestQuestlineProps) => {
  const { tr } = useI18n<I18n, "en">();

  /**
   * Seeded from the loader and edited in place. `QuestlineDialog` renders a
   * whole `QuestView`, so a quest can be completed or edited from inside the
   * map; without this the card behind the dialog would keep showing the
   * version the page was loaded with.
   */
  const [quests, setQuests] = useState<QuestResource[]>(props.quests);

  const onQuestChange = (changed: QuestResource) => {
    setQuests((current) =>
      current.map((quest) => (quest.id === changed.id ? changed : quest)),
    );
  };

  // A component of one is the quest on its own: nothing depends on it and it
  // depends on nothing. Drawing a single card under the heading "questline"
  // would be a true statement that reads as a broken page, so say it instead.
  if (quests.length <= 1) {
    return (
      <div className="text-muted-foreground min-h-0 flex-1 p-6 text-center text-sm">
        {tr("quest.questline.empty")}
      </div>
    );
  }

  return <Questline quests={quests} onQuestChange={onQuestChange} />;
};

export default QuestQuestline;
