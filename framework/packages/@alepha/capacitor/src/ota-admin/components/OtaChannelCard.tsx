import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  useDialog,
} from "@alepha/ui";
import { DataTable } from "@alepha/ui/table";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { History, Percent, ShieldOff, Undo2 } from "lucide-react";
import { useState } from "react";

import type { OtaAdminController } from "../../ota-api/controllers/OtaAdminController.ts";
import type { OtaAppResource } from "../../ota-api/schemas/otaAppResourceSchema.ts";
import type { OtaBundleResource } from "../../ota-api/schemas/otaBundleResourceSchema.ts";
import type { OtaChannelResource } from "../../ota-api/schemas/otaChannelResourceSchema.ts";
import type { OtaCohortResource } from "../../ota-api/schemas/otaCohortResourceSchema.ts";
import { OtaCohortDialog } from "./OtaCohortDialog.tsx";

export interface OtaChannelCardProps {
  app: OtaAppResource;
  channel: OtaChannelResource;
  bundles: OtaBundleResource[];
}

/**
 * One channel: who may join it, its kill switch, and what each cohort
 * serves (one row per platform and native fingerprint).
 */
export const OtaChannelCard = (props: OtaChannelCardProps) => {
  const client = useClient<OtaAdminController>();
  const dialog = useDialog();
  const { tr } = useI18n();
  const [editing, setEditing] = useState<
    | { cohort: OtaCohortResource; mode: "rollout" | "fallback" | "rollback" }
    | undefined
  >();
  const version = (id?: string) =>
    props.bundles.find((it) => it.id === id)?.version ?? "-";
  const invalidates = [
    ["ota-channels", props.app.id],
    ["ota-bundles", props.app.id],
  ];

  const toggle = useAction(
    {
      handler: async () => {
        await client.otaUpdateChannel({
          params: { id: props.channel.id },
          body: { allowSelfAssign: !props.channel.allowSelfAssign },
        });
      },
      invalidates,
    },
    [client, props.channel],
  );

  const kill = useAction(
    {
      handler: async () => {
        const confirmed = await dialog.confirm({
          title: tr("ota.admin.channels.killTitle", {
            default: "Kill this channel?",
          }),
          description: tr("ota.admin.channels.killConfirm", {
            default:
              "Every bundle channel $1 of $2 serves is killed. Each device falls back to its cohort's fallback, or resets to its built-in web layer, at its next check. A device that stays offline keeps what it runs.",
            args: [props.channel.name, props.app.appId],
          }),
          confirmLabel: tr("ota.admin.kill", { default: "Kill" }),
          destructive: true,
        });
        if (!confirmed) {
          return false;
        }
        await client.otaKillChannel({
          params: { id: props.channel.id },
          body: {},
        });
        return true;
      },
      invalidates,
    },
    [client, dialog, props.channel, props.app],
  );

  const busy = toggle.loading || kill.loading;
  const serving = props.channel.cohorts.some((it) => it.active);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          {props.channel.name}
          {props.channel.isDefault ? (
            <Badge variant="secondary">
              {tr("ota.admin.channels.default", { default: "Default" })}
            </Badge>
          ) : null}
          {props.channel.allowSelfAssign ? (
            <Badge variant="tint" tone="info">
              {tr("ota.admin.channels.public", { default: "Self-assignable" })}
            </Badge>
          ) : null}
        </CardTitle>
        <div className="flex gap-2">
          {props.channel.isDefault ? null : (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => void toggle.run()}
            >
              {props.channel.allowSelfAssign
                ? tr("ota.admin.channels.close", {
                    default: "Close to devices",
                  })
                : tr("ota.admin.channels.open", { default: "Open to devices" })}
            </Button>
          )}
          <Button
            intent="danger"
            disabled={busy || !serving}
            onClick={() => void kill.run()}
          >
            <ShieldOff />
            {tr("ota.admin.channels.kill", { default: "Kill switch" })}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <DataTable<OtaCohortResource>
          flat
          hideColumnPicker
          data={props.channel.cohorts}
          rowKey={(cohort) => cohort.key}
          emptyMessage={tr("ota.admin.channels.noCohort", {
            default: "Nothing published to this channel yet.",
          })}
          rowActions={() => [
            {
              label: tr("ota.admin.cohort.rollout", {
                default: "Change rollout",
              }),
              icon: Percent,
              disabled: () => busy,
              onClick: (cohort) => setEditing({ cohort, mode: "rollout" }),
            },
            {
              label: tr("ota.admin.cohort.fallback", {
                default: "Choose fallback",
              }),
              icon: History,
              disabled: () => busy,
              onClick: (cohort) => setEditing({ cohort, mode: "fallback" }),
            },
            {
              label: tr("ota.admin.cohort.rollback", { default: "Roll back" }),
              icon: Undo2,
              disabled: () => busy,
              onClick: (cohort) => setEditing({ cohort, mode: "rollback" }),
            },
          ]}
          columns={{
            platform: {
              label: tr("ota.admin.cohort.platform", { default: "Platform" }),
              cell: (cohort) => cohort.platform,
            },
            fingerprint: {
              label: tr("ota.admin.cohort.fingerprint", {
                default: "Native fingerprint",
              }),
              cell: (cohort) => (
                <code className="text-xs">
                  {cohort.fingerprint.slice(0, 12)}
                </code>
              ),
            },
            active: {
              label: tr("ota.admin.cohort.active", { default: "Active" }),
              cell: (cohort) => version(cohort.active),
            },
            rollout: {
              label: tr("ota.admin.cohort.share", { default: "Rollout" }),
              align: "right",
              cell: (cohort) => `${cohort.rollout}%`,
            },
            fallback: {
              label: tr("ota.admin.cohort.fallbackColumn", {
                default: "Fallback",
              }),
              cell: (cohort) => version(cohort.fallback),
            },
          }}
        />
      </CardContent>
      {editing ? (
        <OtaCohortDialog
          app={props.app}
          channel={props.channel}
          cohort={editing.cohort}
          mode={editing.mode}
          bundles={props.bundles}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </Card>
  );
};
