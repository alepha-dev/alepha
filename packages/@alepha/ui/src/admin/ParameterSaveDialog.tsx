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
import { z } from "alepha";
import { useAction } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

export interface ParameterSaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Tags to pre-fill the input with (e.g. the current version's tags).
   */
  initialTags?: string[];
  /**
   * Persist the new version with the chosen tags and optional activation date.
   * Should resolve once the save completes; the dialog stays open (with a busy
   * button) until it does.
   */
  onConfirm: (meta: {
    tags: string[];
    activationDate?: string;
  }) => void | Promise<void>;
}

/**
 * Confirmation dialog shown when saving a new parameter version. Collects the
 * free-form tags and an optional activation date (leave empty to apply
 * immediately, set a future date to schedule a `next`/`future` version), then
 * triggers the save.
 */
export const ParameterSaveDialog = (props: ParameterSaveDialogProps) => {
  const { tr } = useI18n();
  const form = useForm(
    {
      schema: z.object({
        tags: z.array(z.string()).optional(),
        activationDate: z.string().meta({ format: "date-time" }).optional(),
      }),
      initialValues: { tags: props.initialTags ?? [] },
      handler: async () => {},
    },
    [props.open],
  );

  const save = useAction(
    {
      handler: async () => {
        await props.onConfirm({
          tags: form.currentValues.tags ?? [],
          activationDate: form.currentValues.activationDate || undefined,
        });
        props.onOpenChange(false);
      },
    },
    [props.onConfirm, props.onOpenChange, form],
  );

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
              default:
                "Optionally tag and schedule this version before saving.",
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
        <Control
          input={form.input.activationDate}
          datetime
          label={tr("admin.parameters.fieldActivationDate", {
            default: "Activate at",
          })}
          description={tr("admin.parameters.activationDateHint", {
            default: "Leave empty to apply immediately.",
          })}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={save.loading}
            onClick={() => props.onOpenChange(false)}
          >
            {tr("admin.parameters.cancel", { default: "Cancel" })}
          </Button>
          <Button
            type="button"
            loading={save.loading}
            onClick={() => save.run()}
          >
            {tr("admin.parameters.save", { default: "Save new version" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
