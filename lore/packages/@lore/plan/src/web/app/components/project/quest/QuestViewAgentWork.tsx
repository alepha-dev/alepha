import { Badge, Button, useToast } from "@alepha/ui";
import { currentProjectAtom, type I18n, useRank } from "@lore/core/web";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Bot, ShieldCheck } from "lucide-react";

import type { QuestAgentController } from "../../../../../api/controllers/QuestAgentController.ts";
import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";

export interface QuestViewAgentWorkProps {
  quest: QuestResource;
  onChanged: (patch: Partial<QuestResource>) => void;
}

/**
 * **Work it with Claude** (#Q3989): an accepted quest worked by an agent job
 * on the project's Agent host, which pushes `lore/q<n>`. Shown on an
 * accepted, open quest only, with a default Agent host and `code:write`. An
 * untrusted quest (born of feedback written outside the team) first needs a
 * member to confirm its text, recorded with who and when.
 */
const QuestViewAgentWork = ({ quest, onChanged }: QuestViewAgentWorkProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const api = useClient<QuestAgentController>();
  const [project] = useStore(currentProjectAtom);

  const work = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        await api.workQuestWithAgent({
          params: { projectId: project.id, shortId: quest.shortId },
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

  const open = Boolean(quest.acceptedAt) && !quest.completedAt;
  if (!project?.defaultAgentHostId || !open) return null;
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
  return (
    <Button
      variant="outlined"
      size="sm"
      onClick={() => void work.run()}
      disabled={work.loading}
      data-testid="quest-agent-work"
    >
      <Bot className="size-4" />
      {tr("quest.agent.work")}
    </Button>
  );
};

export default QuestViewAgentWork;
