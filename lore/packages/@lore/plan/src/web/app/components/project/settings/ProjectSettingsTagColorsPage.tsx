import { Card, CardContent, cn } from "@alepha/ui";
import { settingsCardEdge } from "@alepha/ui/settings";

import ProjectSettingsTagColors from "./ProjectSettingsTagColors.tsx";

/**
 * Plan > Tags (#Q4061, "Tag colours" until #Q4182): a tab of its own, out of Features. The colours
 * belong to quests, not to the board: they render on the list too, so the
 * tab is listed with the capability, not with `board`.
 */
const ProjectSettingsTagColorsPage = () => (
  <Card className={cn(settingsCardEdge, "py-4")}>
    <CardContent className="px-4">
      <ProjectSettingsTagColors />
    </CardContent>
  </Card>
);

export default ProjectSettingsTagColorsPage;
