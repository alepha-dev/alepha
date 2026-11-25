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
import type { PromptResource } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

export interface PromptPinsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: PromptResource;
  /**
   * The pinnable pages, as the server lists them.
   */
  pages: Array<{ key: string; label: string }>;
  /**
   * The pins picked, in the server's page order. The dialog closes at once
   * and the page writes them optimistically (#Q4301): a set of known page
   * keys is nothing the server refuses for its shape, so there is no field
   * error to wait for.
   */
  onSave: (pins: string[]) => void;
}

/**
 * Where a prompt is pinned (#Q4284): one multi select over the pinnable
 * pages (#Q4300, where it was a column of switches, one per page). Any
 * prompt on any page; pinning a built-in creates its row, and an empty
 * selection unpins it everywhere.
 */
const PromptPinsDialog = (props: PromptPinsDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const keys = new Set(props.pages.map((page) => page.key));

  const form = useForm(
    {
      schema: z.object({ pins: z.array(z.text({ maxLength: 32 })).optional() }),
      initialValues: {
        pins: props.prompt.pins.filter((key) => keys.has(key)),
      },
      handler: async (values) => {
        const pins = values.pins ?? [];
        props.onSave(
          props.pages
            .filter((page) => pins.includes(page.key))
            .map((page) => page.key),
        );
        props.onOpenChange(false);
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
            inputProps={{ "data-testid": "prompt-pins-pages" }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => props.onOpenChange(false)}
            >
              {tr("prompts.cancel")}
            </Button>
            <Button type="submit" data-testid="prompt-pins-save">
              {tr("prompts.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default PromptPinsDialog;
