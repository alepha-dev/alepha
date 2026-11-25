import { useToast } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { PromptController } from "../../../../api/controllers/PromptController.ts";

/**
 * Copy and Run of a prompt (#Q4280), one place for the Prompts tab, the
 * pinned button and the spotlight (#Q4284). Copy renders through the API
 * and puts the text on the clipboard; Run starts the job on a host and opens
 * the job's page, where its progress shows.
 */
export const usePromptActions = (
  projectId: number | undefined,
  slug: string,
) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<PromptController>();
  const toaster = useToast();
  // A page name another router declares: the job page is core's own.
  const router = useRouter<any>();

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
        await router.push("projectJob", {
          params: { projectSlug: slug, jobId: out.jobId },
        });
        return true;
      },
      invalidates: [["project-prompts", projectId]],
    },
    [api, projectId, slug],
  );

  return { copy, run };
};
