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

export interface StackEnvironmentAddDialogProps {
  onOpenChange: (open: boolean) => void;
  projectId: number;
  stackId: string;
  stackName: string;
}

/**
 * A new environment of a stack, in a dialog opened from its row's menu
 * (#Q4320), deploying to the stack's default host until its Settings say
 * otherwise. Mounted only while open, so each opening starts empty.
 */
const StackEnvironmentAddDialog = (props: StackEnvironmentAddDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const stackApi = useClient<StackController>();
  const queries = useQueryClient();

  const form = useForm({
    id: `stack-environment-add-${props.stackId}`,
    schema: z.object({ env: z.string().min(1).max(64) }),
    initialValues: { env: "" },
    handler: async (input) => {
      await stackApi.createStackEnvironment({
        params: { projectId: props.projectId, stackId: props.stackId },
        body: { env: input.env.trim() },
      });
      queries.invalidate(["stacks", props.projectId]);
      toaster.success(tr("stacks.environment.added"));
      props.onOpenChange(false);
    },
  });
  const { loading } = useFormState(form, ["loading"]);

  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent data-testid="stack-environment-dialog">
        <DialogHeader>
          <DialogTitle>{tr("stacks.environment.add")}</DialogTitle>
          <DialogDescription>
            {tr("stacks.environment.add.description", {
              args: [props.stackName],
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <div data-testid="stack-environment-name">
            <Control
              input={form.input.env}
              label={tr("stacks.environment.name")}
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
              data-testid="stack-environment-add"
            >
              {tr("stacks.environment.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default StackEnvironmentAddDialog;
