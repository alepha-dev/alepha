import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import AutomationAdoptionCard from "./AutomationAdoptionCard.tsx";

const AutomationAdoptionPage = () => {
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();
  const [busy, setBusy] = useState(false);
  if (!project) return null;
  return (
    <div className="flex max-w-4xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">
          {tr("automation.adoption.title")}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {tr("automation.adoption.description")}
        </p>
      </div>
      <AutomationAdoptionCard
        project={project}
        policy="quest-reminders"
        disabled={busy}
        onBusyChange={setBusy}
      />
      <AutomationAdoptionCard
        project={project}
        policy="release-notifications"
        disabled={busy}
        onBusyChange={setBusy}
      />
    </div>
  );
};
export default AutomationAdoptionPage;
