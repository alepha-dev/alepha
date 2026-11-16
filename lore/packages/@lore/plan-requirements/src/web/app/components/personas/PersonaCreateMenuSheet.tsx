import type { ProjectCreateDialogProps } from "@lore/core/web";
import { useQueryClient } from "alepha/react";
import { useRouter } from "alepha/react/router";

import PersonaSheet from "./PersonaSheet.tsx";

/**
 * New persona, from the header's "+" menu (registered by
 * `RequirementsShell`). Opens the persona it made.
 */
const PersonaCreateMenuSheet = (props: ProjectCreateDialogProps) => {
  // A page of this package, named by string from a registry-driven menu.
  const router = useRouter<any>();
  const queries = useQueryClient();

  return (
    <PersonaSheet
      projectId={props.project.id}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onSubmit={(persona) => {
        props.onOpenChange(false);
        queries.invalidate(["personas", props.project.id]);
        void router.push("projectPersona", {
          params: {
            projectSlug: props.project.slug,
            personaNumber: String(persona.number),
          },
        });
      }}
    />
  );
};

export default PersonaCreateMenuSheet;
