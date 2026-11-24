import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQueryClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { ChatAgentController } from "../../../../api/controllers/ChatAgentController.ts";
import type { ChatAgentBudgetResource } from "../../../../api/schemas/chatAgentBudgetResourceSchema.ts";

export interface ChatAgentBudgetFormProps {
  projectId: number;
  budget: ChatAgentBudgetResource;
}

/**
 * The budget's one field, mounted once the budget is read: `useForm` takes
 * its initial value at mount.
 */
const ChatAgentBudgetForm = (props: ChatAgentBudgetFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<ChatAgentController>();
  const queries = useQueryClient();
  const form = useForm({
    id: "chat-agent-budget",
    schema: z.object({
      tokens: z.integer().min(1000).max(100_000_000).optional(),
    }),
    initialValues: { tokens: props.budget.tokens },
    handler: async ({ tokens }) => {
      await api.setChatAgentBudget({
        params: { projectId: props.projectId },
        body: { tokens: tokens ?? null },
      });
      queries.invalidate(["chat-agent-budget", props.projectId]);
    },
  });
  return (
    <form
      {...form.props}
      className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-6"
    >
      <div data-testid="chat-agent-budget-tokens">
        <Control
          input={form.input.tokens}
          label={tr("chat.agents.budget.tokens")}
          description={tr("chat.agents.budget.tokensHint")}
        />
      </div>
      <div className="flex justify-start sm:justify-end">
        <Button
          type="submit"
          variant="outlined"
          data-testid="chat-agent-budget-save"
        >
          {tr("chat.agents.budget.save")}
        </Button>
      </div>
    </form>
  );
};

export default ChatAgentBudgetForm;
