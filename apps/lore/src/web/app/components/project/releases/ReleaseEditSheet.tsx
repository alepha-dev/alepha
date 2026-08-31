import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useI18n } from "alepha/react/i18n";

import type { Release } from "@/api/entities/releases.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ReleaseEditForm from "./ReleaseEditForm.tsx";

export interface ReleaseEditSheetProps {
  release: ReleaseResource;
  artifactCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (release: Release) => void;
}

/**
 * The right-hand drawer around {@link ReleaseEditForm}, with the same
 * geometry as the Create Quest and Create Epic ones (`50vw` from the right,
 * header pinned, body scrolls).
 *
 * A drawer rather than the 560px dialog this started as, and the rule that
 * decides it is written down on `ReleaseCreateDialog`: **the container
 * follows the form**. A one-field create gets a dialog; a form carrying a
 * markdown editor gets a sheet. The release edit form grew that editor when
 * its description stopped being a bare textarea, so it moved.
 */
const ReleaseEditSheet = (props: ReleaseEditSheetProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[50vw]"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>{tr("release.edit.title")}</SheetTitle>
        </SheetHeader>
        {/* Keyed on the release AND its `updatedAt`, so reopening the drawer
            re-reads the release. `useForm` anchors its schema and initial
            values at mount; without this the drawer would reopen holding an
            abandoned draft, and a save made elsewhere would be invisible to
            it. This IS the "opening snapshots the release" contract. */}
        <ReleaseEditForm
          key={`${props.release.id}:${props.release.updatedAt}`}
          release={props.release}
          artifactCount={props.artifactCount}
          onSubmit={props.onSubmit}
          onCancel={() => props.onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
};

export default ReleaseEditSheet;
