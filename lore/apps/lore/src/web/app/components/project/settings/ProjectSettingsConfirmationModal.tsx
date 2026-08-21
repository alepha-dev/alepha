import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alepha/ui/components/ui/alert-dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsConfirmationModalProps {
  open: boolean;
  project: { title: string };
  onCancel: () => void;
  onConfirm: () => void;
}

const ProjectSettingsConfirmationModal = (
  props: ProjectSettingsConfirmationModalProps,
) => {
  const [inputValue, setInputValue] = useState("");
  const { tr } = useI18n<I18n, "en">();
  const isValid = inputValue === props.project.title;

  // Clear on the open → closed transition, during render so a reopen never
  // flashes the previous attempt's text.
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (!props.open) setInputValue("");
  }

  return (
    <AlertDialog open={props.open} onOpenChange={(o) => !o && props.onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {tr("project.settings.delete.modal.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {tr("project.settings.delete.modal.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {tr("project.settings.delete.modal.confirm", {
              args: [props.project.title],
            })}
          </p>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.currentTarget.value)}
            placeholder={props.project.title}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={props.onCancel}>
            {tr("project.settings.delete.modal.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!isValid}
            onClick={(e) => {
              if (!isValid) {
                e.preventDefault();
                return;
              }
              props.onConfirm();
            }}
            className="bg-destructive hover:bg-destructive/90 text-white"
          >
            {tr("project.settings.delete.modal.submit")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ProjectSettingsConfirmationModal;
