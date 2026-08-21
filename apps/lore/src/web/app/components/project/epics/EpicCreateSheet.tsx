import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useI18n } from "alepha/react/i18n";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import EpicCreate from "./EpicCreate.tsx";

export interface EpicCreateSheetProps {
  projectId: number;
  /** Present ⇒ the drawer edits that epic; absent ⇒ it creates one. */
  epic?: EpicResource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (epic: EpicResource) => void;
}

/**
 * The right-hand drawer around {@link EpicCreate}, with the same geometry as
 * the Create Quest one (`50vw` from the right, header pinned, body scrolls).
 *
 * It exists because three surfaces open this form — the header's create
 * menu, the Epics list toolbar, and Edit on the epic's own page — and the
 * `Sheet` boilerplate was going to be copied into each of them. The form is
 * `EpicCreate`; this is only the container.
 */
const EpicCreateSheet = (props: EpicCreateSheetProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[50vw]"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>
            {props.epic ? tr("epic.edit") : tr("project.menu.create-epic")}
          </SheetTitle>
        </SheetHeader>
        {/* Keyed on the epic so switching which one is edited (or going from
            create to edit) rebuilds the form. `useForm` anchors its schema
            and initial values at mount, so without this the drawer would
            reopen still holding the previous epic's title. */}
        <EpicCreate
          key={props.epic?.id ?? "new"}
          projectId={props.projectId}
          epic={props.epic}
          onSubmit={props.onSubmit}
        />
      </SheetContent>
    </Sheet>
  );
};

export default EpicCreateSheet;
