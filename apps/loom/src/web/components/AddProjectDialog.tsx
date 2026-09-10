import { Dialog, DialogContent } from "@alepha/ui/components/ui/dialog";

import { AddProjectDialogForm } from "./AddProjectDialogForm.tsx";

export interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Adds a repository to Loom and opens it. The form is mounted only while the
 * dialog is open, so every opening starts empty.
 */
export const AddProjectDialog = (props: AddProjectDialogProps) => {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {props.open && (
          <AddProjectDialogForm onDone={() => props.onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
};
