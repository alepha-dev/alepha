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
 * Inline edit drawer for a reporter's own pending petition. Edits title,
 * description and tags via `updateMyPetition` (attachments are left as-is).
 * Opened from the row actions on {@link MyPetitions}.
 */
const MyPetitionEditSheet = (props: MyPetitionEditSheetProps) => {
  const petitionApi = useClient<PetitionController>();
  const toaster = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

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
      <SheetContent className="flex w-full flex-col gap-4 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit petition</SheetTitle>
          <SheetDescription>
            You can edit a petition only while it is still pending.
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
              disabled={saving}
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
              disabled={saving}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Tags</span>
            <QuestTagInput value={tags} onChange={setTags} disabled={saving} />
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={props.onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default MyPetitionEditSheet;
