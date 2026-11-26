import { useToast } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { useAction, useAlepha, useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { PromptController } from "../../../../api/controllers/PromptController.ts";
import {
  jobsAnnouncementAtom,
  jobsStartedHereAtom,
} from "../jobs-header/jobsHeaderAtoms.ts";

/**
 * Copy and Run of a prompt (#Q4280), one place for the Prompts tab, the
 * pinned button and the spotlight (#Q4284). Copy renders through the API
 * and puts the text on the clipboard.
 *
 * Run starts the job on a host and stays on the page (#Q4514): the job
 * shows in the header's jobs list as queued, and the jobs button names it,
 * then names it again when it ends. A run queued behind one of the same
 * args (#Q4354) says so in a toast. With `open` (the job page's Run again
 * and Start fresh), it opens the new job's page instead, or the one it
 * waits behind.
 */
export const usePromptActions = (
  projectId: number | undefined,
  slug: string,
  options: { open?: boolean } = {},
) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<PromptController>();
  const toaster = useToast();
  // A page name another router declares: the job page is core's own.
  const router = useRouter<any>();
  const dateTime = useInject(DateTimeProvider);
  const alepha = useAlepha();
  const open = options.open ?? false;

  const copy = useAction<[name: string, args: Record<string, string>], boolean>(
    {
      handler: async (_ctx, name, args) => {
        if (projectId === undefined) return false;
        const { text } = await api.renderPrompt({
          params: { projectId, name },
          body: { args },
        });
        await navigator.clipboard.writeText(text);
        toaster.success(tr("prompts.copied"));
        return true;
      },
    },
    [api, projectId],
  );

  const run = useAction<
    [
      name: string,
      body: {
        args: Record<string, string>;
        host?: string;
        // The Model select's pick (#Q4504): a model with its agent CLI.
        agent?: string;
        model?: string;
        fix?: boolean;
        trust?: boolean;
        // A job that ended unfinished, continued (#Q4340).
        continue?: string;
      },
    ],
    boolean
  >(
    {
      handler: async (_ctx, name, body) => {
        if (projectId === undefined) return false;
        const out = await api.runPrompt({
          params: { projectId, name },
          body,
        });
        // Queued behind a run of the same args (#Q4354): a word that this
        // one waits.
        if (out.queuedBehind) toaster.info(tr("prompts.queued"));
        if (open) {
          const jobId = out.jobId ?? out.queuedBehind;
          if (jobId) {
            await router.push("projectJob", {
              params: { projectSlug: slug, jobId },
            });
          }
          return true;
        }
        if (out.jobId) {
          const jobId = out.jobId;
          alepha.store.set(jobsStartedHereAtom, [
            ...(alepha.store.get(jobsStartedHereAtom) ?? []),
            jobId,
          ]);
          alepha.store.set(jobsAnnouncementAtom, {
            jobId,
            prompt: name,
            word: "queued",
            at: dateTime.nowMillis(),
          });
        }
        return true;
      },
      invalidates: [
        ["project-prompts", projectId],
        ["host-jobs-header", projectId],
      ],
    },
    [api, projectId, slug, open],
  );

  return { copy, run };
};
