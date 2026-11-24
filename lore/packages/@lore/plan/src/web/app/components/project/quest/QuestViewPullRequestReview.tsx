import { Button, useToast } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  currentProjectAtom,
  type I18n,
  orderAgentChoices,
  useRank,
} from "@lore/core/web";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Bot } from "lucide-react";

import type { AgentRunController } from "../../../../../api/controllers/AgentRunController.ts";
import type { QuestAgentController } from "../../../../../api/controllers/QuestAgentController.ts";
import { pullRequestReviewFormSchema } from "../../../../../api/schemas/pullRequestReviewFormSchema.ts";
import type { PullRequest } from "../../../../../api/schemas/pullRequestSchema.ts";

export interface QuestViewPullRequestReviewProps {
  questNumber: number;
  pullRequests: Array<Pick<PullRequest, "number">>;
}

/**
 * **Review with an agent** (#Q4251), under a quest's pull requests: a read
 * job at the pull request's head that posts a review with `gh`, or **review
 * and fix**, a write job on its branch. Shown with `quest:update` and an
 * available Agent host, on the member's last host and agent. The host checks
 * that the author can write to the repository first, unless the member ticks
 * that they trust them.
 */
const QuestViewPullRequestReview = (props: QuestViewPullRequestReviewProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const questApi = useClient<QuestAgentController>();
  const runs = useClient<AgentRunController>();
  const numbered = props.pullRequests.filter((pr) => pr.number);

  const readiness = useQuery(
    {
      enabled: can("quest:update") && !!project?.id && numbered.length > 0,
      handler: () =>
        questApi.getQuestAgentWork({
          params: { projectId: project?.id as number },
        }),
      onError: () => {},
    },
    [questApi, project?.id, numbered.length],
  );

  const form = useForm({
    schema: pullRequestReviewFormSchema,
    initialValues: { trust: false },
    handler: async () => {},
  });
  const trust = useFormValues(form).trust === true;

  const review = useAction<[pr: number, fix: boolean], void>(
    {
      handler: async (_ctx, pr, fix) => {
        if (!project) return;
        const [choice] = orderAgentChoices(
          project.id,
          readiness.data?.choices ?? [],
        );
        await runs.runAgent({
          params: { projectId: project.id },
          body: {
            prompt: "review-pr",
            pr,
            quest: props.questNumber,
            ...(fix ? { fix: true } : {}),
            ...(trust ? { trust: true } : {}),
            ...(choice?.host ? { host: choice.host } : {}),
            ...(choice?.agent ? { agent: choice.agent } : {}),
          },
        });
        toaster.show(tr("quest.agent.review.started"), "success");
      },
    },
    [runs, project?.id, props.questNumber, readiness.data, trust, toaster, tr],
  );

  if (!project || !readiness.data?.ready || !numbered.length) return null;
  return (
    <span
      className="flex flex-col items-end gap-1"
      data-testid="quest-pr-review"
    >
      {numbered.map((pr) => (
        <span key={pr.number} className="flex flex-wrap justify-end gap-1">
          <Button
            variant="outlined"
            size="sm"
            onClick={() => void review.run(pr.number as number, false)}
            disabled={review.loading}
            data-testid="quest-pr-review-run"
          >
            <Bot className="size-4" />
            {tr("quest.agent.review", { args: [String(pr.number)] })}
          </Button>
          <Button
            variant="outlined"
            size="sm"
            onClick={() => void review.run(pr.number as number, true)}
            disabled={review.loading}
            data-testid="quest-pr-review-fix"
          >
            {tr("quest.agent.reviewFix", { args: [String(pr.number)] })}
          </Button>
        </span>
      ))}
      <Control
        input={form.input.trust}
        label={tr("quest.agent.review.trust")}
      />
    </span>
  );
};

export default QuestViewPullRequestReview;
