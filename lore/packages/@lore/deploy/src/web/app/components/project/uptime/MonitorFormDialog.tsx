import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { type I18n, TokenReveal } from "@lore/core/web";
import { useClient, useQueryClient } from "alepha/react";
import {
  FormValidationError,
  useForm,
  useFormState,
  useFormValues,
} from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { MonitorController } from "../../../../../api/controllers/MonitorController.ts";
import { monitorNotificationSettingsSchema } from "../../../../../api/schemas/monitorNotificationSettingsSchema.ts";
import type { MonitorResource } from "../../../../../api/schemas/monitorResourceSchema.ts";
import { MonitorTarget } from "../../../../../api/schemas/MonitorTarget.ts";
import { monitorFormSchema } from "./monitorFormSchema.ts";

export interface MonitorFormDialogProps {
  projectId: number;
  monitor?: MonitorResource;
  onClose: () => void;
}
const MonitorFormDialog = (props: MonitorFormDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<MonitorController>();
  const queries = useQueryClient();
  const [token, setToken] = useState<string>();
  const monitor = props.monitor;
  const form = useForm({
    id: `monitor-${monitor?.id ?? "new"}`,
    schema: monitorFormSchema,
    initialValues: {
      name: monitor?.name ?? "",
      kind: monitor?.kind ?? "http",
      target: monitor?.target ?? "",
      intervalSecs: monitor?.intervalSecs ?? 60,
      timeoutSecs: monitor?.timeoutSecs ?? 10,
      confirmations: monitor?.confirmations ?? 2,
      expectedStatus: monitor?.expect.status,
      keyword: monitor?.expect.keyword,
      latencyBudgetMs: monitor?.expect.latencyBudgetMs,
      certWarningDays: monitor?.expect.certWarningDays ?? 14,
      emailAlerts: monitor?.notifications.email ?? true,
      recipients: monitor?.notifications.recipients.join(", ") ?? "",
    },
    onError: () => {},
    handler: async (values) => {
      // Form initialization takes a partial schema, which cannot carry object refinements.
      if (new MonitorTarget().error(values.kind, values.target)) {
        throw new FormValidationError({
          message: tr("uptime.invalidTarget"),
          path: "/target",
        });
      }
      const notifications = monitorNotificationSettingsSchema.safeParse({
        email: values.emailAlerts,
        recipients: values.recipients
          .split(/[,;\n]/)
          .map((value) => value.trim())
          .filter(Boolean),
      });
      if (!notifications.success)
        throw new FormValidationError({
          path: "/recipients",
          message: tr("uptime.invalidRecipients"),
        });
      const body = {
        notifications: notifications.data,
        name: values.name,
        kind: values.kind,
        target: values.target,
        intervalSecs: values.intervalSecs,
        timeoutSecs: values.timeoutSecs,
        confirmations: values.confirmations,
        expect:
          values.kind === "http"
            ? {
                status: values.expectedStatus,
                keyword: values.keyword || undefined,
                latencyBudgetMs: values.latencyBudgetMs,
              }
            : values.kind === "cert"
              ? { certWarningDays: values.certWarningDays }
              : {},
      };
      if (monitor) {
        await api.updateMonitor({ params: { monitorId: monitor.id }, body });
        queries.invalidate(["uptime-monitors", props.projectId]);
        props.onClose();
      } else {
        const created = await api.createMonitor({
          params: { projectId: props.projectId },
          body,
        });
        queries.invalidate(["uptime-monitors", props.projectId]);
        if (created.token)
          setToken(
            `${globalThis.location?.origin ?? ""}/uptime/push/${created.token}`,
          );
        else props.onClose();
      }
    },
  });
  const { loading, error } = useFormState(form, ["loading", "error"]);
  const values = useFormValues(form);
  const kind = values.kind;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !loading) props.onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {tr(monitor ? "uptime.editTitle" : "uptime.createTitle")}
          </DialogTitle>
        </DialogHeader>
        {token ? (
          <TokenReveal
            token={token}
            title={tr("uptime.tokenTitle")}
            copyLabel={tr("uptime.copyUrl")}
            copiedMessage={tr("uptime.copied")}
            doneLabel={tr("uptime.done")}
            onDismiss={props.onClose}
          />
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.submit();
            }}
          >
            <Control
              input={form.input.name}
              label={tr("uptime.name")}
              disabled={loading}
            />
            <Control
              select
              input={form.input.kind}
              label={tr("uptime.kindLabel")}
              disabled={loading || Boolean(monitor)}
              description={monitor ? tr("uptime.kindImmutable") : undefined}
              items={["http", "tcp", "cert", "push"].map((value) => ({
                value,
                label: tr(`uptime.kind.${value}` as never),
              }))}
            />
            {kind !== "push" ? (
              <Control
                input={form.input.target}
                rows={1}
                inputProps={{ className: "min-h-10 resize-none" }}
                label={tr("uptime.target")}
                disabled={loading}
                description={tr(
                  kind === "http" ? "uptime.httpTarget" : "uptime.socketTarget",
                )}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                {tr("uptime.pushDescription")}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Control
                number
                input={form.input.intervalSecs}
                label={tr(
                  kind === "push" ? "uptime.staleAfter" : "uptime.interval",
                )}
                disabled={loading}
              />
              {kind !== "push" && (
                <Control
                  number
                  input={form.input.timeoutSecs}
                  label={tr("uptime.timeout")}
                  disabled={loading}
                />
              )}
              <Control
                number
                input={form.input.confirmations}
                label={tr("uptime.confirmations")}
                disabled={loading}
              />
            </div>
            {kind === "http" && (
              <>
                <Control
                  number
                  input={form.input.expectedStatus}
                  label={tr("uptime.expectedStatus")}
                  disabled={loading}
                />
                <Control
                  input={form.input.keyword}
                  rows={1}
                  label={tr("uptime.keyword")}
                  disabled={loading}
                />
                <Control
                  number
                  input={form.input.latencyBudgetMs}
                  label={tr("uptime.budget")}
                  disabled={loading}
                />
              </>
            )}
            {kind === "cert" && (
              <Control
                number
                input={form.input.certWarningDays}
                label={tr("uptime.certWarning")}
                disabled={loading}
              />
            )}
            <div className="border-t pt-4">
              <Control
                input={form.input.emailAlerts}
                label={tr("uptime.emailAlerts")}
                description={tr("uptime.emailAlertsDescription")}
                disabled={loading}
              />
              <Control
                input={form.input.recipients}
                rows={2}
                label={tr("uptime.recipients")}
                description={tr("uptime.recipientsDescription")}
                disabled={loading}
              />
            </div>
            {error && (
              <p role="alert" className="text-danger-text text-sm">
                {error.message}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outlined"
                disabled={loading}
                onClick={props.onClose}
              >
                {tr("uptime.cancel")}
              </Button>
              <Button type="submit" disabled={loading}>
                {tr(monitor ? "uptime.save" : "uptime.create")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
export default MonitorFormDialog;
