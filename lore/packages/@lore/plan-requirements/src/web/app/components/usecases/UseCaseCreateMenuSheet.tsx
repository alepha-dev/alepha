import type { ProjectCreateDialogProps } from "@lore/core/web";
import { useQueryClient } from "alepha/react";
import { useRouter } from "alepha/react/router";

import UseCaseSheet from "./UseCaseSheet.tsx";

/**
 * New use case, from the header's "+" menu (registered by
 * `RequirementsShell`). Opens the use case it made.
 */
const UseCaseCreateMenuSheet = (props: ProjectCreateDialogProps) => {
  // A page of this package, named by string from a registry-driven menu.
  const router = useRouter<any>();
  const queries = useQueryClient();

  return (
    <UseCaseSheet
      projectId={props.project.id}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onSubmit={(useCase) => {
        props.onOpenChange(false);
        queries.invalidate(["use-cases", props.project.id]);
        void router.push("projectUseCase", {
          params: {
            projectSlug: props.project.slug,
            useCaseNumber: String(useCase.number),
          },
        });
      }}
    />
  );
};

export default UseCaseCreateMenuSheet;
