import type { ProjectCreateDialogProps } from "@lore/core/web";
import { useQueryClient } from "alepha/react";
import { useRouter } from "alepha/react/router";

import RequirementSheet from "./RequirementSheet.tsx";

/**
 * New requirement, from the header's "+" menu (registered by
 * `RequirementsShell`). Opens the requirement it made, as New use case and
 * New persona do.
 */
const RequirementCreateMenuSheet = (props: ProjectCreateDialogProps) => {
  // A page of this package, named by string from a registry-driven menu.
  const router = useRouter<any>();
  const queries = useQueryClient();

  return (
    <RequirementSheet
      projectId={props.project.id}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onSubmit={(requirement) => {
        props.onOpenChange(false);
        queries.invalidate(["requirements", props.project.id]);
        void router.push("projectRequirement", {
          params: {
            projectSlug: props.project.slug,
            requirementNumber: String(requirement.number),
          },
        });
      }}
    />
  );
};

export default RequirementCreateMenuSheet;
