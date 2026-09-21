import { useDialog, useToast } from "@alepha/ui";
import { useAction, useClient, useQueryClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { ArtifactController } from "@/api/controllers/ArtifactController.ts";
import { currentInstancesAtom } from "@/web/app/atoms/currentInstancesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { settleBulk } from "../../shared/bulkOutcome.ts";
import { useBulkReport } from "../../shared/useBulkReport.ts";

/**
 * Delete an artifact, or a selection of them, after saying what the row does
 * not show (feedback #P2209).
 *
 * `ArtifactService.delete` existed with nothing calling it, so a build pushed
 * by mistake stayed in the registry for good. The project Artifacts table's
 * row menu and its checkbox selection are the two doors now, and they share
 * this hook so the single and the bulk confirm cannot start disagreeing about
 * what a delete costs.
 *
 * ## The server allows it, the confirm names it
 *
 * `deployments.artifactId` is a soft reference, so the deploy history keeps
 * its rows whatever is deleted. Two costs are invisible from the row, and the
 * confirm raises each only when it applies:
 *
 * - **A deployed copy runs this tag.** Read from `currentInstancesAtom`, which
 *   the project route loader already holds, so the confirm costs no request.
 *   The match is `(app, tag)`, because an instance's `version` is a tag and
 *   names no runtime: the sentence says "this tag is running" and no more.
 * - **The tag is `latest`.** Deploys that name no tag use it, and fail until
 *   CI pushes it again.
 *
 * ⚠️ **No guard is added anywhere.** Neither case is refused, by the quest's
 * decision: the dialog is where the loss is named, not where it is prevented.
 *
 * ⚠️ **It invalidates the page's listing, once per run.** The table is in
 * static-data mode, so its own `ctx.refresh()` re-fetches nothing: the rows
 * belong to the page's `useQuery`, keyed `["project-artifacts", projectId]`.
 */
export const useDeleteArtifact = (): DeleteArtifact => {
  const artifactApi = useClient<ArtifactController>();
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const toaster = useToast();
  const reportBulk = useBulkReport();
  const queries = useQueryClient();
  const [instances] = useStore(currentInstancesAtom);

  const name = (artifact: DeletableArtifact): string =>
    `${artifact.app} ${artifact.tag} (${artifact.runtimes.join(" + ")}, ${artifact.format})`;

  /**
   * The copies whose newest successful deploy is this app at this tag, as
   * `app/env`. An unreadable instance list reads as none: the confirm is a
   * warning, and the delete is allowed either way.
   */
  const runningOn = (artifact: DeletableArtifact): string[] =>
    (instances ?? [])
      .filter(
        (instance) =>
          instance.app === artifact.app && instance.version === artifact.tag,
      )
      .map((instance) => `${instance.app}/${instance.env}`);

  const sentences = (parts: Array<string | undefined>): string =>
    parts.filter((sentence): sentence is string => Boolean(sentence)).join(" ");

  // One `useAction` per verb (#E59 rule 1). A refused delete rejects inside
  // the handler, so `remove` resolves `undefined` and the root
  // `ActionErrorToaster` shows the server's message.
  const removeAction = useAction<[artifact: DeletableArtifact], boolean>(
    {
      handler: async (artifact) => {
        const label = name(artifact);
        const running = runningOn(artifact);
        const ok = await dialog.confirm({
          title: tr("artifacts.delete.title", { args: [label] }),
          description: sentences([
            tr("artifacts.delete.body"),
            running.length > 0
              ? tr("artifacts.delete.running", { args: [running.join(", ")] })
              : undefined,
            artifact.tag === "latest"
              ? tr("artifacts.delete.latest")
              : undefined,
          ]),
          confirmLabel: tr("artifacts.delete.action"),
          cancelLabel: tr("common.cancel"),
          destructive: true,
        });
        if (!ok) return false;

        await artifactApi.deleteArtifact({
          params: { projectId: artifact.projectId, artifactId: artifact.id },
        });
        toaster.success(tr("artifacts.delete.done", { args: [label] }));
        // By hand rather than through `invalidates`: the key carries the
        // project, which only the artifact in hand names.
        queries.invalidate(["project-artifacts", artifact.projectId]);
        return true;
      },
    },
    [artifactApi, dialog, toaster, tr, queries, instances],
  );

  const removeManyAction = useAction<[selected: DeletableArtifact[]], boolean>(
    {
      handler: async (selected) => {
        if (selected.length === 0) return false;
        const n = String(selected.length);
        const ok = await dialog.confirm({
          title: tr("artifacts.bulk.delete.title", { args: [n] }),
          description: sentences([
            tr("artifacts.bulk.delete.body"),
            selected.some((artifact) => runningOn(artifact).length > 0)
              ? tr("artifacts.bulk.delete.running")
              : undefined,
            selected.some((artifact) => artifact.tag === "latest")
              ? tr("artifacts.bulk.delete.latest")
              : undefined,
          ]),
          confirmLabel: tr("artifacts.bulk.delete.confirm", { args: [n] }),
          cancelLabel: tr("common.cancel"),
          destructive: true,
        });
        if (!ok) return false;

        // Every call settles, and the report says how many landed: one
        // refusal must not hide the deletes that went through, nor stop the
        // ones after it.
        const projectId = selected[0].projectId;
        const outcome = await settleBulk(
          selected.map((artifact) => artifact.id),
          (artifactId) =>
            artifactApi.deleteArtifact({ params: { projectId, artifactId } }),
        );
        reportBulk(
          outcome,
          tr("board.bulk.deleted", { args: [String(outcome.done.length)] }),
        );
        queries.invalidate(["project-artifacts", projectId]);
        return true;
      },
    },
    [artifactApi, dialog, reportBulk, tr, queries, instances],
  );

  return {
    can: artifactApi.deleteArtifact.can(),
    busy: removeAction.loading || removeManyAction.loading,
    remove: removeAction.run,
    removeMany: removeManyAction.run,
  };
};

/**
 * What the hook reads off a row: the two ids the endpoint takes, and the four
 * fields the confirm names it by.
 */
export interface DeletableArtifact {
  id: string;
  projectId: number;
  app: string;
  tag: string;
  runtime: string;
  /**
   * Every slice the variant carries, which is how the confirm names it.
   */
  runtimes: string[];
  format: string;
}

export interface DeleteArtifact {
  /**
   * Whether this rank may delete an artifact. Hide the row entry, and the
   * checkbox column with it, when false.
   */
  can: boolean;
  /**
   * True while a delete runs. A second one made meanwhile is dropped, so the
   * caller disables its entries for that time.
   */
  busy: boolean;
  /**
   * Confirms, deletes, toasts, and invalidates the listing. Resolves `true`
   * once the artifact is gone, `false` when the reader backed out, and
   * `undefined` when the server refused, which has already been toasted.
   */
  remove: (artifact: DeletableArtifact) => Promise<boolean | undefined>;
  /**
   * The same over a selection. Resolves `true` once the run happened, even
   * when some of it was refused (the report says how many landed), so the
   * caller clears the selection; `false` only when the reader backed out.
   */
  removeMany: (selected: DeletableArtifact[]) => Promise<boolean | undefined>;
}
