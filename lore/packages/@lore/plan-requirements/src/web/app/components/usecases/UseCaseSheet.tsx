import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import UseCaseForm from "./UseCaseForm.tsx";

export interface UseCaseSheetProps {
  projectId: number;
  useCase?: UseCaseResource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (useCase: UseCaseResource) => void;
}

/**
 * The right-hand drawer around {@link UseCaseForm}, the geometry of the
 * epic and quest drawers: three surfaces open it (the create menu, the
 * Use cases tab, Edit on the use case's page).
 */
const UseCaseSheet = (props: UseCaseSheetProps) => {
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
              props.useCase
                ? "requirements.usecase.edit"
                : "project.menu.create-usecase",
            )}
          </SheetTitle>
        </SheetHeader>
        {/* Keyed so switching which use case is edited rebuilds the form:
            `useForm` anchors its values at mount. */}
        <UseCaseForm
          key={props.useCase?.id ?? "new"}
          projectId={props.projectId}
          useCase={props.useCase}
          onSubmit={props.onSubmit}
        />
      </SheetContent>
    </Sheet>
  );
};

export default UseCaseSheet;
