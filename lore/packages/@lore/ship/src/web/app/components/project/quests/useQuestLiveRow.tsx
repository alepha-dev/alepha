import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import {
  canInProject,
  currentProjectAtom,
  hasCapability,
  type I18n,
  type ResourceRailSubject,
} from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import type { ReactNode } from "react";

import type { LiveQuestController } from "../../../../../api/controllers/LiveQuestController.ts";

/**
 * The quest rail's Live row (#E154), registered by `DeployShell` on core's
 * `ResourceRailRegistry`: one chip per deployed copy running the quest's
 * commits, "my-app/production · since 2 hours", marked unverified when that
 * build came from a dirty working tree.
 *
 * `undefined`, so no row, when the project has no Ship, while the read is in
 * flight, and when no copy runs the quest: the rail says nothing rather than
 * "not live", which the quest list's filter is the place to claim.
 */
export const useQuestLiveRow = (
  subject: ResourceRailSubject,
): ReactNode | undefined => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const dt = useInject(DateTimeProvider);
  const router = useRouter<any>();
  const api = useClient<LiveQuestController>();
  // The read is `app:read`, which a viewer of an open project lacks (#Q3794).
  const enabled =
    hasCapability(project, "ship") && canInProject(project, "app:read");

  const { data } = useQuery(
    {
      enabled,
      key: ["quest-liveness", subject.projectId, subject.number],
      handler: () =>
        api.getQuestLiveness({
          params: { projectId: subject.projectId, number: subject.number },
        }),
      // A failure costs the row, not the page.
      onError: () => {},
    },
    [api, subject.projectId, subject.number],
  );

  if (!enabled || !project || !data?.instances.length) {
    return undefined;
  }

  return (
    <span className="flex min-w-0 flex-wrap justify-end gap-1">
      {data.instances.map((instance) => {
        const name = `${instance.app}/${instance.env}`;
        const text = instance.since
          ? tr("quest.live.since", {
              args: [name, dt.of(instance.since).fromNow(true)],
            })
          : name;
        return (
          <Badge
            key={instance.instanceId}
            variant={instance.dirty ? "outline" : "tint"}
            data-testid={`quest-live-${name}`}
          >
            <Link
              href={router.path("app", {
                params: {
                  projectSlug: project.slug,
                  app: instance.app,
                  env: instance.env,
                },
              })}
            >
              {text}
            </Link>
            {instance.dirty && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="text-muted-foreground ml-1">
                      {tr("quest.live.unverified")}
                    </span>
                  }
                />
                <TooltipContent className="max-w-xs text-left">
                  {tr("quest.live.unverified.hint")}
                </TooltipContent>
              </Tooltip>
            )}
          </Badge>
        );
      })}
    </span>
  );
};
