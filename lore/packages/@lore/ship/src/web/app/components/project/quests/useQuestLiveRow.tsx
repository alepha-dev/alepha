import { HoverCard, HoverCardContent, HoverCardTrigger } from "@alepha/ui";
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
 * `ResourceRailRegistry`: a one-line summary of the deployed copies running
 * the quest's commits, the first one's name and "+3" for the others, and on
 * hover or keyboard focus a card listing every copy, "my-app/production,
 * since 2 hours", marked unverified when that build came from a dirty
 * working tree. The summary stays one line however many copies there are:
 * one chip per copy wrapped into a ragged block four rows tall.
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

  const instances = data.instances;
  const nameOf = (instance: (typeof instances)[number]) =>
    `${instance.app}/${instance.env}`;
  const anyDirty = instances.some((instance) => instance.dirty);

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={150}
        render={
          <button
            type="button"
            aria-label={tr("quest.live.summary", { args: [instances.length] })}
            data-testid="quest-live-summary"
            className="focus-visible:ring-ring/50 inline-flex min-w-0 items-center gap-1.5 rounded-sm text-sm outline-none focus-visible:ring-[3px]"
          />
        }
      >
        <span
          aria-hidden
          className={
            anyDirty
              ? "size-1.5 shrink-0 rounded-full bg-amber-500"
              : "size-1.5 shrink-0 rounded-full bg-emerald-500"
          }
        />
        <span className="truncate">{nameOf(instances[0])}</span>
        {instances.length > 1 && (
          <span className="text-muted-foreground shrink-0 tabular-nums">
            +{instances.length - 1}
          </span>
        )}
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="end"
        className="flex w-auto max-w-80 min-w-56 flex-col gap-1.5"
        data-testid="quest-live-card"
      >
        {instances.map((instance) => {
          const name = nameOf(instance);
          return (
            <div
              key={instance.instanceId}
              className="flex items-baseline justify-between gap-4"
              data-testid={`quest-live-${name}`}
            >
              <Link
                className="truncate font-medium hover:underline"
                href={router.path("app", {
                  params: {
                    projectSlug: project.slug,
                    app: instance.app,
                    env: instance.env,
                  },
                })}
              >
                {name}
              </Link>
              <span className="text-muted-foreground shrink-0 text-xs">
                {instance.dirty && (
                  <span className="text-amber-600 dark:text-amber-500">
                    {tr("quest.live.unverified")}
                    {instance.since ? " · " : ""}
                  </span>
                )}
                {instance.since &&
                  tr("quest.live.since", {
                    args: [dt.of(instance.since).fromNow(true)],
                  })}
              </span>
            </div>
          );
        })}
        {anyDirty && (
          <p className="text-muted-foreground border-t pt-1.5 text-xs">
            {tr("quest.live.unverified.hint")}
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
};
