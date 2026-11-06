import { Button, useDialog, useToast } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { StackController } from "../../../../../api/controllers/StackController.ts";

export interface StackDeleteButtonProps {
  projectId: number;
  stackId: string;
  stackName: string;
}

/**
 * Deletes a stack with no environment left (#Q3136). Shown only on an empty
 * stack: the server refuses while an environment remains, and each one is
 * forgotten first from its own Settings tab.
 */
const StackDeleteButton = (props: StackDeleteButtonProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const toaster = useToast();
  const api = useClient<StackController>();

  const remove = useAction<[], boolean>(
    {
      handler: async () => {
        const confirmed = await dialog.confirm({
          title: tr("stacks.delete.confirm", { args: [props.stackName] }),
          description: tr("stacks.delete.description"),
          confirmLabel: tr("stacks.delete"),
          destructive: true,
        });
        if (!confirmed) {
          return false;
        }
        await api.deleteStack({
          params: { projectId: props.projectId, stackId: props.stackId },
        });
        toaster.success(tr("stacks.deleted"));
        return true;
      },
      invalidates: [["stacks", props.projectId]],
    },
    [api, dialog, toaster, tr, props.projectId, props.stackId, props.stackName],
  );

  return (
    <Button
      variant="outlined"
      intent="danger"
      size="sm"
      disabled={remove.loading}
      onClick={() => remove.run()}
      data-testid={`stack-delete-${props.stackName}`}
    >
      {tr("stacks.delete")}
    </Button>
  );
};

export default StackDeleteButton;
