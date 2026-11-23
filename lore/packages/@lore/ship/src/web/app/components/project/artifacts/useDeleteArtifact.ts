import { useDialog } from "@alepha/ui";
import type { BulkActionContext } from "@alepha/ui/table";
import {
  type I18n,
  settleBulk,
  useBulkReport,
  useOptimisticWrite,
} from "@lore/core/web";
import { useClient, useQueryClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { ArtifactController } from "../../../../../api/controllers/ArtifactController.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";

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
 * ## Optimistic, like a quest or an epic
 *
 * Once confirmed, the row plays its exit and the delete is sent at once; a
 * refusal puts the row back.
 *
 * ⚠️ **It invalidates the page's listing, once per run.** The table is in
 * static-data mode, so its own `ctx.refresh()` re-fetches nothing: the rows
 * belong to the page's `useQuery`, keyed `["project-artifacts", projectId]`.
 */
export const useDeleteArtifact = (): DeleteArtifact => {
  const artifactApi = useClient<ArtifactController>();
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const optimistic = useOptimisticWrite();
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

  /**
   * The table's exit, plus the listing's own cache.
   *
   * ⚠️ The table is in static-data mode, where a settled overlay lets go at
   * once: the row would come back until the refetch answered. So the settle
   * first drops the variants from the cached listing, then lets go.
   */
  const hide = <T extends DeletableArtifact>(
    ctx: DeleteContext<T>,
    selected: T[],
  ) => {
    const handle = ctx.optimistic.remove(selected);
    return {
      rollback: handle.rollback,
      settle: () => {
        const ids = new Set(selected.map((artifact) => artifact.id));
        queries.setData<ArtifactListing | undefined>(
          ["project-artifacts", selected[0].projectId],
          (previous) =>
            previous && {
              ...previous,
              groups: previous.groups
                .map((group) => ({
                  ...group,
                  variants: group.variants.filter(
                    (variant) => !ids.has(variant.id),
                  ),
                }))
                .filter((group) => group.variants.length > 0),
            },
        );
        handle.settle();
      },
    };
  };

  // Not `useAction`: `useOptimisticWrite` must run from the click itself, so
  // the row leaves in the click's frame.
  const remove = async <T extends DeletableArtifact>(
    artifact: T,
    ctx: DeleteContext<T>,
  ): Promise<boolean> => {
    const label = name(artifact);
    const running = runningOn(artifact);
    const ok = await dialog.confirm({
      title: tr("artifacts.delete.title", { args: [label] }),
      description: sentences([
        tr("artifacts.delete.body"),
        running.length > 0
          ? tr("artifacts.delete.running", { args: [running.join(", ")] })
          : undefined,
        artifact.tag === "latest" ? tr("artifacts.delete.latest") : undefined,
      ]),
      confirmLabel: tr("artifacts.delete.action"),
      cancelLabel: tr("common.cancel"),
      destructive: true,
    });
    if (!ok) return false;

    void optimistic.run({
      message: tr("artifacts.delete.done", { args: [label] }),
      intent: "primary",
      apply: () => hide(ctx, [artifact]),
      commit: () =>
        artifactApi.deleteArtifact({
          params: { projectId: artifact.projectId, artifactId: artifact.id },
        }),
      onCommitted: () =>
        queries.invalidate(["project-artifacts", artifact.projectId]),
    });
    return true;
  };

  const removeMany = async <T extends DeletableArtifact>(
    selected: T[],
    ctx: DeleteContext<T>,
  ): Promise<boolean> => {
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

    const projectId = selected[0].projectId;
    void optimistic.run({
      message: tr("board.bulk.deleted", { args: [n] }),
      intent: "primary",
      apply: () => hide(ctx, selected),
      // Every call settles: one refusal must not hide the deletes that went
      // through, nor stop the ones after it. Only a refusal is reported, and
      // the refetch puts the refused rows back.
      commit: async () => {
        const outcome = await settleBulk(
          selected.map((artifact) => artifact.id),
          (artifactId) =>
            artifactApi.deleteArtifact({ params: { projectId, artifactId } }),
        );
        if (outcome.failed.length > 0) reportBulk(outcome, "");
      },
      onCommitted: () => queries.invalidate(["project-artifacts", projectId]),
    });
    return true;
  };

  return {
    can: artifactApi.deleteArtifact.can(),
    remove,
    removeMany,
  };
};

/**
 * The listing as the page caches it, as far as the settle reads it.
 */
interface ArtifactListing {
  groups: Array<{ variants: Array<{ id: string }> }>;
}

/**
 * What the hook needs of the table's action context: its optimistic rows.
 */
export type DeleteContext<T> = Pick<BulkActionContext<T>, "optimistic">;

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
   * Confirms, then takes the row off the table and sends the delete. Resolves `true` once confirmed,
   * `false` when the reader backed out. A refusal rolls the row back and is
   * toasted by the root `ActionErrorToaster`.
   */
  remove: <T extends DeletableArtifact>(
    artifact: T,
    ctx: DeleteContext<T>,
  ) => Promise<boolean>;
  /**
   * The same over a selection. Resolves `true` once confirmed, so the
   * caller clears the selection; `false` when the reader backed out.
   */
  removeMany: <T extends DeletableArtifact>(
    selected: T[],
    ctx: DeleteContext<T>,
  ) => Promise<boolean>;
}
