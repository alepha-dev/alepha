import {
  Badge,
  Button,
  Card,
  CardContent,
  useDialog,
  useToast,
} from "@alepha/ui";
import { settingsCardEdge } from "@alepha/ui/settings";
import {
  canInProject,
  currentProjectAtom,
  displayName,
  type I18n,
  loreDocsUrl,
  useProjectUsers,
} from "@lore/core/web";
import {
  useAction,
  useClient,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { ChatAgentController } from "../../../../api/controllers/ChatAgentController.ts";
import type { ChatAgentResource } from "../../../../api/schemas/chatAgentResourceSchema.ts";
import ChatAgentAvatar from "../ChatAgentAvatar.tsx";
import ChatAgentBudgetCard from "./ChatAgentBudgetCard.tsx";
import ChatAgentDialog from "./ChatAgentDialog.tsx";

/**
 * Settings > Chat > Agents (#E170, #Q4199): the project's chat agents.
 *
 * Every rank that reads chat sees the list, the built-in `@lore` first when
 * AI is on; creating, editing and deleting are `chat:agent`'s, hidden
 * without it (the server checks again). With AI off the agents are still
 * listed and edited, with one line saying none answers.
 */
const ChatAgentsSettingsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const api = useClient<ChatAgentController>();
  const queries = useQueryClient();
  const [project] = useStore(currentProjectAtom);
  const users = useProjectUsers();
  const projectId = project?.id ?? 0;
  const canWrite = !!project && canInProject(project, "chat:agent");
  const [editing, setEditing] = useState<ChatAgentResource | "new" | undefined>(
    undefined,
  );

  const { data } = useQuery(
    {
      key: ["chat-agents", projectId],
      enabled: projectId > 0,
      handler: () => api.listChatAgents({ params: { projectId } }),
    },
    [api, projectId],
  );
  const agents = data?.items ?? [];
  const own = agents.filter((agent) => !agent.builtin);
  const refresh = () => queries.invalidate(["chat-agents", projectId]);

  const remove = useAction<[agent: ChatAgentResource], void>(
    {
      handler: async (_context, agent) => {
        const confirmed = await dialog.confirm({
          title: tr("chat.agents.deleteTitle", { args: [agent.handle] }),
          description: tr("chat.agents.deleteDescription"),
          confirmLabel: tr("chat.agents.deleteConfirm"),
          destructive: true,
        });
        if (!confirmed) return;
        await api.deleteChatAgent({
          params: { projectId, agentId: agent.id },
        });
        refresh();
        toaster.success(tr("chat.agents.deleted"));
      },
    },
    [api, projectId, dialog],
  );

  const creator = (agent: ChatAgentResource) => {
    const user = users.find((it) => it.id === agent.createdBy);
    return user ? displayName(user) : undefined;
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className={settingsCardEdge}>
        <CardContent className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-medium">
                {tr("chat.agents.title")}
              </span>
              <span className="text-muted-foreground text-xs">
                {tr("chat.agents.description")}
              </span>
            </div>
            {canWrite && (
              <Button
                size="sm"
                onClick={() => setEditing("new")}
                data-testid="chat-agent-create"
              >
                <Plus className="size-4" aria-hidden="true" />
                {tr("chat.agents.create")}
              </Button>
            )}
          </div>

          {data && !data.enabled && (
            <p
              className="text-muted-foreground text-xs"
              data-testid="chat-agents-ai-off"
            >
              {tr("chat.agents.aiOff")}
            </p>
          )}

          {data && own.length === 0 && (
            <p
              className="text-muted-foreground text-sm"
              data-testid="chat-agents-empty"
            >
              {tr("chat.agents.empty")}{" "}
              <a
                href={loreDocsUrl("project-chat-agents")}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                {tr("chat.agents.docs")}
              </a>
            </p>
          )}

          {agents.length > 0 && (
            <ul className="divide-y rounded-md border">
              {agents.map((agent) => (
                <li
                  key={agent.id}
                  data-testid="chat-agent-row"
                  data-handle={agent.handle}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <ChatAgentAvatar
                    name={agent.name}
                    avatarId={agent.avatarId}
                    builtin={agent.builtin}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate text-sm font-medium">
                        {agent.name}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        @{agent.handle}
                      </span>
                      {agent.builtin && (
                        <Badge variant="tint" tone="violet">
                          {tr("chat.agents.builtin")}
                        </Badge>
                      )}
                    </div>
                    {!agent.builtin && (
                      <span className="text-muted-foreground truncate text-xs">
                        {agent.model ?? tr("chat.agents.defaultModel")}
                        {creator(agent)
                          ? ` · ${tr("chat.agents.by", { args: [creator(agent)!] })}`
                          : ""}
                      </span>
                    )}
                  </div>
                  {canWrite && !agent.builtin && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="minimal"
                        aria-label={tr("chat.agents.edit")}
                        onClick={() => setEditing(agent)}
                        data-testid="chat-agent-edit"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="minimal"
                        aria-label={tr("chat.agents.delete")}
                        onClick={() => void remove.run(agent)}
                        data-testid="chat-agent-delete"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {editing && (
            <ChatAgentDialog
              projectId={projectId}
              agentId={editing === "new" ? undefined : editing.id}
              onClose={() => setEditing(undefined)}
              onSaved={() => {
                setEditing(undefined);
                refresh();
                toaster.success(tr("chat.agents.saved"));
              }}
            />
          )}
        </CardContent>
      </Card>
      {/* What the agents may spend, and spent (#Q4237). */}
      <ChatAgentBudgetCard />
    </div>
  );
};

export default ChatAgentsSettingsPage;
