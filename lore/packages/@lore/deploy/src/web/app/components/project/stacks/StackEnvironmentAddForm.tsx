import { Button, useToast } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { StackController } from "../../../../../api/controllers/StackController.ts";

export interface StackEnvironmentAddFormProps {
  projectId: number;
  stackId: string;
}

/**
 * A new environment of a stack, deploying to the stack's default estate until
 * its Settings say otherwise.
 */
const StackEnvironmentAddForm = (props: StackEnvironmentAddFormProps) => {
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
      form.reset();
      toaster.success(tr("stacks.environment.added"));
    },
  });
  const { loading } = useFormState(form, ["loading"]);

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit();
      }}
    >
      <div className="w-48" data-testid="stack-environment-name">
        <Control input={form.input.env} label={tr("stacks.environment.name")} />
      </div>
      <Button
        type="submit"
        variant="outlined"
        disabled={loading}
        data-testid="stack-environment-add"
      >
        {tr("stacks.environment.add")}
      </Button>
    </form>
  );
};

export default StackEnvironmentAddForm;
