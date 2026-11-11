import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { usePageCrumb } from "../../shared/usePageCrumb.ts";
import AutomationAdoptionCard from "./AutomationAdoptionCard.tsx";
import AutomationPage from "./AutomationPage.tsx";

const AutomationAdoptionPage = () => {
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();
  // The trail ends with this page (#Q3408).
  usePageCrumb("projectAutomationAdoption", tr("automation.adoption.title"));
  const [busy, setBusy] = useState(false);
  if (!project) return null;
  return (
    <AutomationPage
      title={tr("automation.adoption.title")}
      description={tr("automation.adoption.description")}
    >
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
    </AutomationPage>
  );
};
export default AutomationAdoptionPage;
