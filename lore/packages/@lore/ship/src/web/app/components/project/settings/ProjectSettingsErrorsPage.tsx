import { Button } from "@alepha/ui";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";
import {
  currentProjectAtom,
  hasCapability,
  type I18n,
  ProjectSettingsThreshold,
} from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Ban } from "lucide-react";
import { useState } from "react";

import ProjectErrorRulesDialog from "../errors/ProjectErrorRulesDialog.tsx";
import ProjectSettingsTrustServerErrors from "./ProjectSettingsTrustServerErrors.tsx";

/**
 * Plan > Errors (#Q3703): whether server errors are trusted on arrival
 * (#Q4257) and the error Ignore rules, where the Errors inbox's settings
 * belong, beside the other Plan tabs. The page is Ship's, since the
 * rules and their dialog are, and Ship adds the tab to Plan's section.
 *
 * Ignore rules are standing configuration, not triage: the inbox is where
 * you decide about one failure that already happened, and a rule decides
 * what never lands at all. Rule mutations are owner-only server-side, so
 * this stays an owner-facing page; do not re-expose it on the inbox.
 */
const ProjectSettingsErrorsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [rulesOpen, setRulesOpen] = useState(false);

  if (!project || !hasCapability(project, "ship")) return null;

  return (
    <div className="flex flex-col gap-6">
      <ProjectSettingsTrustServerErrors />
      <SettingsSection>
        <SettingsRow
          label={tr("errors.rules.title")}
          description={tr("errors.rules.settingsDescription")}
        >
          <Button variant="outlined" onClick={() => setRulesOpen(true)}>
            <Ban className="size-4" />
            {tr("errors.rules.manage")}
          </Button>
        </SettingsRow>
      </SettingsSection>
      <ProjectSettingsThreshold kind="errors" />

      <ProjectErrorRulesDialog
        open={rulesOpen}
        projectId={project.id}
        onOpenChange={setRulesOpen}
      />
    </div>
  );
};

export default ProjectSettingsErrorsPage;
