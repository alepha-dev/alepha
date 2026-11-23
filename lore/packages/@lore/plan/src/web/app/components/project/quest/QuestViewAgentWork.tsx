import { Badge, Button, useToast } from "@alepha/ui";
import {
  type AgentChoice,
  agentChoiceText,
  currentProjectAtom,
  type I18n,
  orderAgentChoices,
  rememberAgentChoice,
  useRank,
} from "@lore/core/web";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Bot, ShieldCheck } from "lucide-react";

import type { QuestAgentController } from "../../../../../api/controllers/QuestAgentController.ts";
import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";

export interface QuestViewAgentWorkProps {
  quest: QuestResource;
  onChanged: (patch: Partial<QuestResource>) => void;
}

/**
 * **Work it with an agent** (#Q3989): an accepted quest worked by an agent
 * job on one of the project's Agent hosts. Shown on an accepted, open quest
 * only, with an available Agent host and `code:write`: one button with one
 * host and agent to pick, one per choice otherwise, the member's last pick
 * first (#Q4223). An untrusted quest (born of feedback written outside the
 * team) first needs a member to confirm its text, recorded with who and
 * when.
 */
const QuestViewAgentWork = ({ quest, onChanged }: QuestViewAgentWorkProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const api = useClient<QuestAgentController>();
  const [project] = useStore(currentProjectAtom);

  const open = Boolean(quest.acceptedAt) && !quest.completedAt;
  const readiness = useQuery(
    {
      enabled: open && can("code:write") && !!project?.id,
      handler: () =>
        api.getQuestAgentWork({
          params: { projectId: project?.id as number },
        }),
      onError: () => {},
    },
    [api, project?.id, open],
  );

  const work = useAction<[choice: AgentChoice], void>(
    {
      handler: async (_ctx, choice) => {
        if (!project) return;
        rememberAgentChoice(project.id, choice);
        await api.workQuestWithAgent({
          params: { projectId: project.id, shortId: quest.shortId },
          body: choice,
        });
        toaster.show(tr("quest.agent.started"), "success");
      },
    },
    [api, project?.id, quest.shortId, toaster, tr],
  );

  const confirm = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        const out = await api.confirmUntrustedQuest({
          params: { projectId: project.id, shortId: quest.shortId },
        });
        onChanged(out);
      },
    },
    [api, project?.id, quest.shortId, onChanged],
  );

  if (!project || !open || !readiness.data?.ready) return null;
  if (quest.untrusted && !quest.untrustedConfirmedAt) {
    return (
      <span className="flex items-center gap-2" data-testid="quest-untrusted">
        <Badge variant="tint" tone="warning">
          {tr("quest.untrusted")}
        </Badge>
        {can("quest:update") && (
          <Button
            variant="outlined"
            size="sm"
            onClick={() => void confirm.run()}
            disabled={confirm.loading}
            title={tr("quest.untrusted.confirm.description")}
            data-testid="quest-untrusted-confirm"
          >
            <ShieldCheck className="size-4" />
            {tr("quest.untrusted.confirm")}
          </Button>
        )}
      </span>
    );
  }
  if (!can("code:write")) return null;
  const choices = orderAgentChoices(project.id, readiness.data.choices);
  const many = choices.length > 1;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {choices.map((choice) => (
        <Button
          key={`${choice.host}-${choice.agent ?? ""}`}
          variant="outlined"
          size="sm"
          onClick={() => void work.run(choice)}
          disabled={work.loading}
          data-testid="quest-agent-work"
        >
          <Bot className="size-4" />
          {many
            ? `${tr("quest.agent.work")} (${agentChoiceText(choice)})`
            : tr("quest.agent.work")}
        </Button>
      ))}
    </span>
  );
};

export default QuestViewAgentWork;
