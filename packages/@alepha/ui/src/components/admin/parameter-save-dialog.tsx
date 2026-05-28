import * as React from "react";

void React;

import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { t } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

export interface ParameterSaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Tags to pre-fill the input with (e.g. the current version's tags).
   */
  initialTags?: string[];
  /**
   * Persist the new version with the chosen tags. Should resolve once the save
   * completes; the dialog stays open (with a busy button) until it does.
   */
  onConfirm: (tags: string[]) => void | Promise<void>;
}

/**
 * Confirmation dialog shown when saving a new parameter version. Collects the
 * free-form tags to attach to the version, then triggers the save.
 */
export const ParameterSaveDialog = (props: ParameterSaveDialogProps) => {
  const { tr } = useI18n();
  const [saving, setSaving] = useState(false);
  const form = useForm(
    {
      schema: t.object({ tags: t.optional(t.array(t.string())) }),
      initialValues: { tags: props.initialTags ?? [] },
      handler: async () => {},
    },
    [props.open],
  );

  const onSave = async () => {
    setSaving(true);
    try {
      await props.onConfirm(form.currentValues.tags ?? []);
      props.onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("admin.parameters.saveDialogTitle", {
              default: "Save new version",
            })}
          </DialogTitle>
          <DialogDescription>
            {tr("admin.parameters.saveDialogDescription", {
              default: "Optionally tag this version before saving it.",
            })}
          </DialogDescription>
        </DialogHeader>
        <Control
          input={form.input.tags}
          combobox
          createNewEntry
          label={tr("admin.parameters.fieldTags", { default: "Tags" })}
          placeholder={tr("admin.parameters.tagsPlaceholder", {
            default: "Add tags…",
          })}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => props.onOpenChange(false)}
          >
            {tr("admin.parameters.cancel", { default: "Cancel" })}
          </Button>
          <Button type="button" disabled={saving} onClick={onSave}>
            {tr("admin.parameters.save", { default: "Save new version" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
