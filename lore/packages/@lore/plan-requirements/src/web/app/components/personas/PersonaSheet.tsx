import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import PersonaForm from "./PersonaForm.tsx";

export interface PersonaSheetProps {
  projectId: number;
  persona?: PersonaResource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (persona: PersonaResource) => void;
}

/**
 * The right-hand drawer around {@link PersonaForm}, the geometry of the
 * epic and quest drawers: three surfaces open it (the create menu, the
 * Personas tab, Edit on the persona's page).
 */
const PersonaSheet = (props: PersonaSheetProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[50vw]"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>
            {tr(
              props.persona
                ? "requirements.persona.edit"
                : "project.menu.create-persona",
            )}
          </SheetTitle>
        </SheetHeader>
        {/* Keyed so switching which persona is edited rebuilds the form:
            `useForm` anchors its values at mount. */}
        <PersonaForm
          key={props.persona?.id ?? "new"}
          projectId={props.projectId}
          persona={props.persona}
          onSubmit={props.onSubmit}
        />
      </SheetContent>
    </Sheet>
  );
};

export default PersonaSheet;
