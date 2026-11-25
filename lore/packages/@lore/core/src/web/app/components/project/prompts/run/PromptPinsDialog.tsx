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
 * Where a prompt is pinned (#Q4284): one switch per pinnable page. Any
 * prompt on any page; pinning a built-in creates its row.
 */
const PromptPinsDialog = (props: PromptPinsDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<PromptController>();
  const shape: Record<string, z.ZType> = {};
  const initial: Record<string, boolean> = {};
  for (const page of props.pages) {
    shape[page.key] = z.boolean().optional();
    initial[page.key] = props.prompt.pins.includes(page.key);
  }

  const save = useAction<[values: Record<string, unknown>], void>(
    {
      handler: async (_ctx, values) => {
        await api.updatePrompt({
          params: { projectId: props.projectId, name: props.prompt.name },
          body: {
            pins: props.pages
              .filter((page) => values[page.key] === true)
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
      schema: z.object(shape) as never,
      initialValues: initial as never,
      handler: async (values: Record<string, unknown>) => {
        await save.run(values);
      },
    },
    [props.open, props.prompt.name],
  );
  const input = form.input as Record<string, never>;

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
        <form {...form.props} className="flex flex-col gap-2">
          {props.pages.map((page) => (
            <Control
              key={page.key}
              input={input[page.key]}
              label={tr(`prompts.page.${page.key}`, { default: page.label })}
              switch
              disabled={save.loading}
            />
          ))}
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
