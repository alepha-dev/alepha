import { Card, CardContent } from "@alepha/ui";
import { settingsCardEdge } from "@alepha/ui/settings";
import { canInProject, currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Coins } from "lucide-react";

import type { ChatAgentController } from "../../../../api/controllers/ChatAgentController.ts";
import ChatAgentBudgetForm from "./ChatAgentBudgetForm.tsx";

/**
 * The project's AI budget for its chat agents (#Q4237), on Settings > Chat >
 * Agents: what the agents' runs spent over the window, and, for a rank with
 * `chat:agent`, the budget itself. Empty is no project budget: every run is
 * the mentioner's.
 */
const ChatAgentBudgetCard = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const api = useClient<ChatAgentController>();
  const [project] = useStore(currentProjectAtom);
  const projectId = project?.id ?? 0;
  const canWrite = !!project && canInProject(project, "chat:agent");

  const { data } = useQuery(
    {
      key: ["chat-agent-budget", projectId],
      enabled: projectId > 0,
      handler: () => api.getChatAgentBudget({ params: { projectId } }),
    },
    [api, projectId],
  );

  return (
    <Card className={settingsCardEdge} data-testid="chat-agent-budget">
      <CardContent className="flex flex-col gap-3 px-4 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium">
            {tr("chat.agents.budget.title")}
          </span>
          <span className="text-muted-foreground text-xs">
            {tr("chat.agents.budget.description")}
          </span>
        </div>
        {data && (
          <p
            className="flex items-center gap-1.5 text-sm tabular-nums"
            data-testid="chat-agent-budget-spent"
          >
            <Coins className="text-muted-foreground size-4" aria-hidden />
            {data.tokens
              ? tr("chat.agents.budget.spentOf", {
                  args: [
                    l(data.spent),
                    l(data.tokens),
                    String(data.windowHours),
                  ],
                })
              : tr("chat.agents.budget.none")}
            {data.freesAt &&
              ` ${tr("chat.agents.budget.freesAt", {
                args: [l(data.freesAt, { date: "lll" })],
              })}`}
          </p>
        )}
        {data && canWrite && (
          <ChatAgentBudgetForm
            key={data.tokens ?? "none"}
            projectId={projectId}
            budget={data}
          />
        )}
      </CardContent>
    </Card>
  );
};

export default ChatAgentBudgetCard;
