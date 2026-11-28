import { Badge, Button } from "@alepha/ui";
import { currentProjectAtom, type I18n, useRank } from "@lore/core/web";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ShieldCheck } from "lucide-react";

import type { QuestAgentController } from "../../../../../api/controllers/QuestAgentController.ts";
import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";

export interface QuestViewUntrustedProps {
  quest: QuestResource;
  onChanged: (patch: Partial<QuestResource>) => void;
}

/**
 * An untrusted quest (born of feedback written outside the team) waits for
 * a member to confirm its text before an agent works it (#Q3989), recorded
 * with who and when. The button that started the work from here went with
 * #Q4281: a project pins `work-quest` to the Quest view instead.
 */
const QuestViewUntrusted = (props: QuestViewUntrustedProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const api = useClient<QuestAgentController>();
  const [project] = useStore(currentProjectAtom);
  const { quest, onChanged } = props;

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

  if (!project || quest.completedAt) return null;
  if (!quest.untrusted || quest.untrustedConfirmedAt) return null;
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
          loading={confirm.loading}
          title={tr("quest.untrusted.confirm.description")}
          data-testid="quest-untrusted-confirm"
        >
          <ShieldCheck className="size-4" />
          {tr("quest.untrusted.confirm")}
        </Button>
      )}
    </span>
  );
};

export default QuestViewUntrusted;
