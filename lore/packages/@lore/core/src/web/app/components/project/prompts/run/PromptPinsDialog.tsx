import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { z } from "alepha";
import { useAction, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { PromptController } from "../../../../../../api/controllers/PromptController.ts";
import type { PromptResource } from "../../../../../../api/schemas/promptResourceSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";

export interface PromptPinsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  prompt: PromptResource;
  /**
   * The pinnable pages, as the server lists them.
   */
  pages: Array<{ key: string; label: string }>;
  invalidates: unknown[];
}

/**
 * Where a prompt is pinned (#Q4284): one multi select over the pinnable
 * pages (#Q4300, where it was a column of switches, one per page). Any
 * prompt on any page; pinning a built-in creates its row, and an empty
 * selection unpins it everywhere.
 */
const PromptPinsDialog = (props: PromptPinsDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<PromptController>();
  const keys = new Set(props.pages.map((page) => page.key));

  const save = useAction<[pins: string[]], void>(
    {
      handler: async (_ctx, pins) => {
        await api.updatePrompt({
          params: { projectId: props.projectId, name: props.prompt.name },
          // In the server's page order, whatever order they were picked in,
          // and never a key the server no longer lists.
          body: {
            pins: props.pages
              .filter((page) => pins.includes(page.key))
              .map((page) => page.key),
          },
        });
        props.onOpenChange(false);
      },
      invalidates: [props.invalidates],
    },
    [api, props.projectId, props.prompt.name],
  );
  const form = useForm(
    {
      schema: z.object({ pins: z.array(z.text({ maxLength: 32 })).optional() }),
      initialValues: {
        pins: props.prompt.pins.filter((key) => keys.has(key)),
      },
      handler: async (values) => {
        await save.run(values.pins ?? []);
      },
    },
    [props.open, props.prompt.name],
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="prompt-pins">
        <DialogHeader>
          <DialogTitle>
            {tr("prompts.pins.title", { args: [props.prompt.title] })}
          </DialogTitle>
          <DialogDescription>
            {tr("prompts.pins.description")}
          </DialogDescription>
        </DialogHeader>
        <form {...form.props} className="flex flex-col gap-4">
          <Control
            input={form.input.pins}
            label={tr("prompts.pins.pages")}
            items={props.pages.map((page) => ({
              value: page.key,
              label: tr(`prompts.page.${page.key}`, { default: page.label }),
            }))}
            clearLabel={tr("prompts.pins.none")}
            // A dialog has the width to name the pages, which is what a
            // member checks here; past that, how many.
            maxTriggerLength={60}
            countLabel={(count) =>
              tr("prompts.pins.count", { args: [String(count)] })
            }
            disabled={save.loading}
            inputProps={{ "data-testid": "prompt-pins-pages" }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => props.onOpenChange(false)}
              disabled={save.loading}
            >
              {tr("prompts.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={save.loading}
              data-testid="prompt-pins-save"
            >
              {tr("prompts.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default PromptPinsDialog;
