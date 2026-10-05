import { useRouter } from "alepha/react/router";

import type { ProjectCreateDialogProps } from "../../../registries/ProjectShellRegistry.ts";
import EpicCreateSheet from "./EpicCreateSheet.tsx";

/**
 * New epic, from the header's "+" menu (registered by `WorkShell`, #E75,
 * #Q2624). Opens the epic it made.
 */
const EpicCreateMenuSheet = (props: ProjectCreateDialogProps) => {
  const router = useRouter();

  return (
    <EpicCreateSheet
      projectId={props.project.id}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onSubmit={(epic) => {
        props.onOpenChange(false);
        void router.push("projectEpic", {
          params: {
            projectSlug: props.project.slug,
            epicNumber: String(epic.number),
          },
        });
      }}
    />
  );
};

export default EpicCreateMenuSheet;
