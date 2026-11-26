import { useDialog, useToast } from "@alepha/ui";
import { formatReference, type I18n } from "@lore/core/web";
import { useAction, useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { ProjectErrorController } from "../../../../../api/controllers/ProjectErrorController.ts";
import { currentErrorCountAtom } from "../../../atoms/currentErrorCountAtom.ts";

/**
 * What the verbs act on, and what follows one.
 */
export interface ProjectErrorVerbsOptions {
  projectId: number;
  errorId: number;
  /**
   * After a verb that leaves the error where it is (resolve, trust,
   * withdraw, forward): the page reads itself again.
   */
  onChanged: () => void;
  /**
   * After the delete: there is no error left to show.
   */
  onDeleted: () => void;
}

/**
 * The triage verbs of one error, as its page offers them (#E185): each a
 * `useAction`, so a refusal is the server's sentence in the root toaster
 * and the follow-up runs only after a success.
 *
 * Every verb stays on the page and refreshes it, the delete excepted. The
 * sidebar's open count is read again after each, since a resolve, a forward
 * and a delete all move it.
 */
export const useProjectErrorVerbs = (options: ProjectErrorVerbsOptions) => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const api = useClient<ProjectErrorController>();
  const toaster = useToast();
  const dialog = useDialog();
  const params = {
    projectId: options.projectId,
    errorId: options.errorId,
  };

  // The badge is written, never read here: see the note in `ProjectErrors`.
  const recount = async () => {
    const { count } = await api.countOpenProjectErrors({
      params: { projectId: options.projectId },
    });
    alepha.store.set(currentErrorCountAtom, { count });
  };

  const resolve = useAction(
    {
      handler: async () => {
        await api.resolveProjectError({ params });
        toaster.success(tr("errors.toast.resolved"));
        options.onChanged();
        await recount();
      },
    },
    [api, options.projectId, options.errorId],
  );

  // Session only on the server (#Q4233): a member read the text.
  const trust = useAction(
    {
      handler: async () => {
        await api.trustProjectError({ params });
        toaster.success(tr("errors.toast.trusted"));
        options.onChanged();
      },
    },
    [api, options.projectId, options.errorId],
  );

  const untrust = useAction(
    {
      handler: async () => {
        await api.untrustProjectError({ params });
        toaster.success(tr("errors.toast.untrusted"));
        options.onChanged();
      },
    },
    [api, options.projectId, options.errorId],
  );

  const forward = useAction(
    {
      handler: async () => {
        const res = await api.forwardProjectErrorToQuest({ params, body: {} });
        toaster.success(
          tr("errors.toast.forwarded", {
            args: [formatReference("quest", res.questShortId)],
          }),
        );
        options.onChanged();
        await recount();
      },
    },
    [api, options.projectId, options.errorId],
  );

  // To a quest already filed, by its number: the API has taken
  // `questShortId` since #Q3802, and no screen offered it.
  const link = useAction(
    {
      handler: async () => {
        const answer = await dialog.prompt({
          title: tr("errors.forwardExisting.title"),
          label: tr("errors.forwardExisting.label"),
          validate: (value: string) =>
            /^#?[Qq]?\d+$/.test(value.trim())
              ? null
              : tr("errors.forwardExisting.invalid"),
        });
        if (answer === null) return;
        const questShortId = Number(answer.trim().replace(/^#?[Qq]?/, ""));
        const res = await api.forwardProjectErrorToQuest({
          params,
          body: { questShortId },
        });
        toaster.success(
          tr("errors.toast.linked", {
            args: [formatReference("quest", res.questShortId)],
          }),
        );
        options.onChanged();
        await recount();
      },
    },
    [api, options.projectId, options.errorId, dialog],
  );

  const remove = useAction(
    {
      handler: async () => {
        const ok = await dialog.confirm({
          title: tr("errors.deleteConfirm"),
          confirmLabel: tr("errors.action.delete"),
          cancelLabel: tr("common.cancel"),
          destructive: true,
        });
        if (!ok) return;
        await api.deleteProjectError({ params });
        toaster.success(tr("errors.toast.deleted"));
        await recount();
        options.onDeleted();
      },
    },
    [api, options.projectId, options.errorId, dialog],
  );

  return {
    resolve,
    trust,
    untrust,
    forward,
    link,
    remove,
    /**
     * Page-wide: every control waits while any verb runs, since `run()`
     * drops a call made while its own is in flight.
     */
    busy:
      resolve.loading ||
      trust.loading ||
      untrust.loading ||
      forward.loading ||
      link.loading ||
      remove.loading,
    /**
     * Triage is `error:triage`: read off the action, so nothing here repeats
     * a permission string.
     */
    canTriage: api.resolveProjectError.can(),
  };
};

export type ProjectErrorVerbs = ReturnType<typeof useProjectErrorVerbs>;
