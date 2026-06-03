import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { PetitionController } from "@/api/controllers/PetitionController.ts";
import type { MyPetitionResource } from "@/api/schemas/myPetitionResourceSchema.ts";
import QuestTagInput from "../../campaign/quest/QuestTagInput.tsx";

export interface MyPetitionEditSheetProps {
  /** The petition being edited; `undefined` keeps the sheet closed. */
  petition: MyPetitionResource | undefined;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Inline drawer opened by clicking a row in {@link MyPetitions}. A pending
 * petition is editable — title, description and tags via `updateMyPetition`
 * (attachments are left as-is); a triaged (accepted/rejected) petition renders
 * read-only.
 */
const MyPetitionEditSheet = (props: MyPetitionEditSheetProps) => {
  const petitionApi = useClient<PetitionController>();
  const toaster = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Row click opens this drawer for any petition, but editing is pending-only
  // (the server enforces it too). Non-pending petitions render read-only.
  const readOnly = !props.petition || props.petition.status !== "pending";
  const disabled = saving || readOnly;

  // Re-seed the form whenever a different petition is opened.
  useEffect(() => {
    if (!props.petition) return;
    setTitle(props.petition.title);
    setDescription(props.petition.description);
    setTags(props.petition.tags ?? []);
  }, [props.petition]);

  const save = async () => {
    if (!props.petition) return;
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (!trimmedTitle || !trimmedDescription) {
      toaster.error("Title and description are required.");
      return;
    }
    setSaving(true);
    try {
      await petitionApi.updateMyPetition({
        params: { petitionId: props.petition.id },
        body: { title: trimmedTitle, description: trimmedDescription, tags },
      });
      toaster.success("Petition updated.");
      props.onSaved();
    } catch (error: any) {
      toaster.error(error?.message ?? "Failed to update petition.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={!!props.petition}
      onOpenChange={(open) => !open && props.onClose()}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 data-[side=right]:sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>{readOnly ? "Petition" : "Edit petition"}</SheetTitle>
          <SheetDescription>
            {readOnly
              ? "This petition has already been triaged and can no longer be edited."
              : "You can edit a petition only while it is still pending."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="petition-title">
              Title
            </label>
            <Input
              id="petition-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Short summary"
              disabled={disabled}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-sm font-medium"
              htmlFor="petition-description"
            >
              Description
            </label>
            <Textarea
              id="petition-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              maxLength={10000}
              placeholder="Describe your request"
              disabled={disabled}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Tags</span>
            <QuestTagInput
              value={tags}
              onChange={setTags}
              disabled={disabled}
            />
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={props.onClose} disabled={saving}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default MyPetitionEditSheet;
