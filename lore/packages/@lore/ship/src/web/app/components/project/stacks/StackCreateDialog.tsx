import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { StackController } from "../../../../../api/controllers/StackController.ts";

export interface StackCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  hosts: Array<{ id: string; slug: string; label?: string }>;
}

/**
 * A new stack, in a centered dialog opened from the Stacks table's New
 * stack (#Q4320): its name (the project slug when empty) and its default
 * host. Closes on success.
 */
const StackCreateDialog = (props: StackCreateDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const stackApi = useClient<StackController>();
  const queries = useQueryClient();

  const form = useForm({
    id: "stack-create",
    schema: z.object({
      name: z.string().max(64).optional(),
      hostId: z.string().optional(),
    }),
    initialValues: { name: "", hostId: "" },
    handler: async (input) => {
      await stackApi.createStack({
        params: { projectId: props.projectId },
        body: {
          ...(input.name?.trim() ? { name: input.name.trim() } : {}),
          ...(input.hostId ? { hostId: input.hostId } : {}),
        },
      });
      queries.invalidate(["stacks", props.projectId]);
      form.reset();
      toaster.success(tr("stacks.created"));
      props.onOpenChange(false);
    },
  });
  const { loading } = useFormState(form, ["loading"]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-testid="stack-create-dialog">
        <DialogHeader>
          <DialogTitle>{tr("stacks.create")}</DialogTitle>
          <DialogDescription>
            {tr("stacks.create.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <div data-testid="stack-create-name">
            <Control input={form.input.name} label={tr("stacks.create.name")} />
          </div>
          <div data-testid="stack-create-host">
            <Control
              select
              input={form.input.hostId}
              label={tr("stacks.create.host")}
              items={props.hosts.map((host) => ({
                value: host.id,
                label: host.label ? `${host.slug} (${host.label})` : host.slug,
              }))}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => props.onOpenChange(false)}
            >
              {tr("stacks.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={loading}
              data-testid="stack-create-submit"
            >
              {tr("stacks.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default StackCreateDialog;
