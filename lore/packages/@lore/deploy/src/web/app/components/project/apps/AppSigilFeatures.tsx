import { SIGIL_FEEDBACK_POSITIONS } from "@alepha/lore/sigil";
import { useDialog, useToast } from "@alepha/ui";
import { AutoForm } from "@alepha/ui/form";
import { currentProjectAtom, type I18n, useRank } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQueryClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { AppSecretController } from "../../../../../api/controllers/AppSecretController.ts";
import type { DeployController } from "../../../../../api/controllers/DeployController.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import {
  readSigilConfigVariable,
  writeSigilConfigVariable,
} from "./sigilConfigVariable.ts";
import type { AppEnvironmentItem } from "./useAppEnvironmentActions.ts";

export interface AppSigilFeaturesProps {
  /**
   * The copy's `SIGIL_CONFIG` row, as the Environment endpoint lists it, or
   * `undefined` when it has none. Mount this keyed by that row's `updatedAt`,
   * so a save re-seeds the switches.
   */
  stored: AppEnvironmentItem | undefined;
}

/**
 * What this copy's Sigil collects, as switches over `SIGIL_CONFIG` (#Q3103).
 *
 * ## Why only for a copy Lore deploys
 *
 * The Overview's capabilities card is read-only on purpose: for an app Lore
 * only hears from, what it sends is decided in its own deploy, and a switch
 * the sink cannot honour is worse than none. A copy Lore DEPLOYS is the one
 * case where Lore holds that deploy, which is what the Sigil tab is gated on.
 * The switches write the same `SIGIL_CONFIG` row the Environment tab lists,
 * through the same endpoint, so there is one source of truth and no second
 * path to keep in step.
 *
 * ## A variable changes nothing until the next deploy
 *
 * So saving offers to redeploy the tag this copy runs. `latest` is a pointer
 * whose bytes may have moved since, and the confirmation says so rather than
 * presenting it as the same build.
 *
 * This is not the sigil's `kinds`, which decides what Lore ACCEPTS and is
 * enforced at ingest whatever the app sends.
 */
const AppSigilFeatures = (props: AppSigilFeaturesProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const dialog = useDialog();
  const toaster = useToast();
  const queryClient = useQueryClient();
  const secretApi = useClient<AppSecretController>();
  const deployApi = useClient<DeployController>();
  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);

  const { config, state } = readSigilConfigVariable(props.stored);

  const form = useForm({
    schema: z.object({
      analytics: z.boolean(),
      blights: z.boolean(),
      vitals: z.boolean(),
      feedback: z.boolean(),
      feedbackButton: z.enum(["hidden", ...SIGIL_FEEDBACK_POSITIONS]),
      // One glob per line: a textarea reads better than an add-a-row list
      // for what is usually zero or one entry.
      feedbackButtonExcludedPaths: z.string().max(2_000).optional(),
      reportOutsideProduction: z.boolean(),
    }),
    initialValues: {
      ...config,
      feedbackButtonExcludedPaths:
        config.feedbackButtonExcludedPaths.join("\n"),
    },
    handler: async (values) => {
      if (!project || !instance) return;
      const target = { projectId: project.id, instanceId: instance.id };
      const value = writeSigilConfigVariable({
        ...values,
        feedbackButtonExcludedPaths: (values.feedbackButtonExcludedPaths ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });

      if (value) {
        await secretApi.setAppSecret({
          params: target,
          body: { key: "SIGIL_CONFIG", value },
        });
      } else if (props.stored) {
        // Every switch back at its default: no variable at all, so a default
        // changed later in `@alepha/lore` reaches this copy too.
        await secretApi.deleteAppSecret({
          params: { ...target, key: "SIGIL_CONFIG" },
        });
      }
      queryClient.invalidate(["app-secrets", project.id, instance.id]);

      const tag = instance.version;
      if (!tag) {
        toaster.success(tr("app.sigil.savedNextDeploy"));
        return;
      }
      const redeploy = await dialog.confirm({
        title: tr("app.sigil.redeploy.title"),
        description: tr(
          tag === "latest"
            ? "app.sigil.redeploy.latest"
            : "app.sigil.redeploy.description",
          { args: [tag] },
        ),
        confirmLabel: tr("app.sigil.redeploy.confirm", {
          args: [tag],
        }),
        cancelLabel: tr("app.sigil.redeploy.later"),
      });
      if (!redeploy) {
        toaster.success(tr("app.sigil.savedNextDeploy"));
        return;
      }
      await deployApi.startDeploy({ params: target, body: { tag } });
      queryClient.invalidate(["app-deployments", project.id, instance.id]);
      toaster.success(tr("app.deploy.started", { args: [tag] }));
    },
  });

  if (!project || !instance) {
    return null;
  }

  return (
    <div data-testid="app-sigil-features" className="flex flex-col gap-2">
      <AutoForm
        form={form}
        layout="row"
        // Rank, not ownership, like the table's buttons. ⚠️ Never the
        // boundary: the endpoints refuse on their own.
        disabled={!can("deploy:manage")}
        disabledIfPristine
        requiredMarker={false}
        submitLabel={tr("app.sigil.save")}
        groups={[
          {
            title: tr("app.sigil.title"),
            description: tr(
              state === "unreadable"
                ? "app.sigil.unreadable"
                : "app.sigil.description",
            ),
            fields: [
              "analytics",
              "blights",
              "vitals",
              "feedback",
              "feedbackButton",
              "feedbackButtonExcludedPaths",
              "reportOutsideProduction",
            ],
          },
        ]}
        fields={{
          analytics: {
            label: tr("app.sigil.analytics"),
            description: tr("app.sigil.analytics.desc"),
          },
          blights: {
            label: tr("app.sigil.blights"),
            description: tr("app.sigil.blights.desc"),
          },
          vitals: {
            label: tr("app.sigil.vitals"),
            description: tr("app.sigil.vitals.desc"),
          },
          feedback: {
            label: tr("app.sigil.feedback"),
            description: tr("app.sigil.feedback.desc"),
          },
          feedbackButton: {
            label: tr("app.sigil.feedbackButton"),
            description: tr("app.sigil.feedbackButton.desc"),
            items: [
              {
                value: "bottom-right",
                label: tr("app.sigil.feedbackButton.bottomRight"),
              },
              {
                value: "bottom-left",
                label: tr("app.sigil.feedbackButton.bottomLeft"),
              },
              {
                value: "hidden",
                label: tr("app.sigil.feedbackButton.hidden"),
              },
            ],
          },
          feedbackButtonExcludedPaths: {
            label: tr("app.sigil.excludedPaths"),
            description: tr("app.sigil.excludedPaths.desc"),
            area: true,
            rows: 3,
            placeholder: "/feedback/**",
            // A row-layout control sizes to its content, which leaves an
            // empty textarea a sliver wide.
            inputProps: { className: "w-72 font-mono text-sm" },
          },
          reportOutsideProduction: {
            label: tr("app.sigil.outsideProduction"),
            description: tr("app.sigil.outsideProduction.desc"),
          },
        }}
      />
    </div>
  );
};

export default AppSigilFeatures;
