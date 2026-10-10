import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useClient, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { OtaAdminController } from "../../ota-api/controllers/OtaAdminController.ts";
import type { OtaAppResource } from "../../ota-api/schemas/otaAppResourceSchema.ts";
import type { OtaBundleResource } from "../../ota-api/schemas/otaBundleResourceSchema.ts";
import type { OtaChannelResource } from "../../ota-api/schemas/otaChannelResourceSchema.ts";
import type { OtaCohortResource } from "../../ota-api/schemas/otaCohortResourceSchema.ts";
import { otaCohortFormSchema } from "../schemas/otaCohortFormSchema.ts";

export interface OtaCohortDialogProps {
  app: OtaAppResource;
  channel: OtaChannelResource;
  cohort: OtaCohortResource;
  mode: "rollout" | "fallback" | "rollback";
  bundles: OtaBundleResource[];
  onClose: () => void;
}

/**
 * Change one cohort: its rollout, its fallback, or roll it back to an
 * earlier bundle (any version, as long as it runs on the cohort's binaries
 * and was not killed).
 */
export const OtaCohortDialog = (props: OtaCohortDialogProps) => {
  const client = useClient<OtaAdminController>();
  const queries = useQueryClient();
  const { tr } = useI18n();
  const candidates = props.bundles.filter(
    (it) =>
      it.platform === props.cohort.platform &&
      it.fingerprint === props.cohort.fingerprint &&
      it.status === "ready" &&
      !it.killedAt,
  );
  const form = useForm(
    {
      schema: otaCohortFormSchema,
      initialValues: {
        bundleId:
          props.mode === "fallback"
            ? props.cohort.fallback
            : props.cohort.active,
        rollout: props.cohort.rollout,
      },
      handler: async (values) => {
        const params = { id: props.channel.id };
        if (props.mode === "rollout") {
          await client.otaSetRollout({
            params,
            body: { cohort: props.cohort.key, rollout: values.rollout },
          });
        } else if (props.mode === "fallback") {
          await client.otaSetFallback({
            params,
            body: {
              cohort: props.cohort.key,
              bundleId: values.bundleId || undefined,
            },
          });
        } else if (values.bundleId) {
          await client.otaRollback({
            params,
            body: { bundleId: values.bundleId },
          });
        }
        queries.invalidate(["ota-channels", props.app.id]);
        props.onClose();
      },
    },
    [client, props.mode, props.cohort.key],
  );
  const state = useFormState(form);
  const items = candidates.map((it) => ({
    value: it.id,
    label: it.version,
    description: it.createdAt,
  }));

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {props.mode === "rollout"
              ? tr("ota.admin.cohort.rollout", { default: "Change rollout" })
              : props.mode === "fallback"
                ? tr("ota.admin.cohort.fallback", {
                    default: "Choose fallback",
                  })
                : tr("ota.admin.cohort.rollback", { default: "Roll back" })}
          </DialogTitle>
          <DialogDescription>
            {props.mode === "rollout"
              ? tr("ota.admin.cohort.rolloutHint", {
                  default:
                    "The share of this cohort that gets the active bundle. The others get the fallback. 0 is nobody, 100 is everybody.",
                })
              : props.mode === "fallback"
                ? tr("ota.admin.cohort.fallbackHint", {
                    default:
                      "What devices outside the rollout get, and what a killed active bundle gives way to. None means the built-in web layer.",
                  })
                : tr("ota.admin.cohort.rollbackHint", {
                    default:
                      "Serve an earlier bundle to the whole cohort, even an older version. Devices switch at their next check, then on their next background or restart.",
                  })}
          </DialogDescription>
        </DialogHeader>
        <form {...form.props} id="ota-cohort" className="flex flex-col gap-4">
          {props.mode === "rollout" ? (
            <Control
              input={form.input.rollout}
              number
              label={tr("ota.admin.cohort.share", { default: "Rollout" })}
            />
          ) : (
            <Control
              input={form.input.bundleId}
              select
              items={items}
              clearable={props.mode === "fallback"}
              label={tr("ota.admin.cohort.bundle", { default: "Bundle" })}
            />
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="minimal" onClick={props.onClose}>
            {tr("ota.admin.cancel", { default: "Cancel" })}
          </Button>
          <Button type="submit" form="ota-cohort" loading={state.loading}>
            {tr("ota.admin.save", { default: "Save" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
