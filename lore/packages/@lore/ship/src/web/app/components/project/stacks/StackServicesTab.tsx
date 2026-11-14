import {
  Badge,
  Button,
  Card,
  CardContent,
  formatBytes,
  useDialog,
  useToast,
} from "@alepha/ui";
import { type I18n, useRank } from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { StackDeployController } from "../../../../../api/controllers/StackDeployController.ts";
import StackServiceLogs from "./StackServiceLogs.tsx";
import type { StackTarget } from "./stackTarget.ts";
import { useStackServices } from "./useStackServices.ts";

export interface StackServicesTabProps {
  target: StackTarget;
  stackName: string;
  env: string;
}

/**
 * Each service of the applied revision with what the machine last reported
 * (state, memory, restarts, the image digest pinned at deploy), and the
 * per-service verbs. Stop asks first: it is durable on the machine.
 */
const StackServicesTab = (props: StackServicesTabProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const dialog = useDialog();
  const toaster = useToast();
  const api = useClient<StackDeployController>();
  const { data, loading } = useStackServices(props.target);
  const [logsOf, setLogsOf] = useState<
    { service: string; request: string } | undefined
  >();

  const verb = useAction<
    [service: string, verb: "restart" | "stop" | "start"],
    boolean
  >(
    {
      handler: async (_ctx, service, action) => {
        if (action === "stop") {
          const confirmed = await dialog.confirm({
            title: tr("stacks.services.stop.confirm.title", {
              args: [service],
            }),
            description: tr("stacks.services.stop.confirm.description"),
            confirmLabel: tr("stacks.services.stop"),
            destructive: true,
          });
          if (!confirmed) {
            return false;
          }
        }
        await api.stackServiceAction({
          params: { ...props.target, service, verb: action },
        });
        toaster.success(
          tr("stacks.services.queued", {
            args: [tr(VERB_LABELS[action]), service],
          }),
        );
        return true;
      },
      invalidates: [
        ["stack-services", props.target.projectId, props.target.environmentId],
      ],
    },
    [api, dialog, toaster, tr, props.target],
  );

  const logs = useAction<[service: string], boolean>(
    {
      handler: async (_ctx, service) => {
        const { request } = await api.requestStackLogs({
          params: props.target,
          body: { service, lines: 200 },
        });
        setLogsOf({ service, request });
        return true;
      },
    },
    [api, props.target],
  );

  const services = data?.services ?? [];
  const busy = verb.loading || logs.loading;
  const canWrite = can("deploy:manage");

  if (!loading && services.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {tr("stacks.services.empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <table className="w-full text-sm" data-testid="stack-services">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 font-normal">
                  {tr("stacks.services.col.service")}
                </th>
                <th className="py-1 font-normal">
                  {tr("stacks.services.col.kind")}
                </th>
                <th className="py-1 font-normal">
                  {tr("stacks.services.col.state")}
                </th>
                <th className="py-1 font-normal">
                  {tr("stacks.services.col.memory")}
                </th>
                <th className="py-1 font-normal">
                  {tr("stacks.services.col.restarts")}
                </th>
                <th className="py-1 font-normal">
                  {tr("stacks.services.col.image")}
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr
                  key={service.name}
                  className="border-t"
                  data-testid={`stack-service-${service.name}`}
                >
                  <td className="py-2 font-medium">{service.name}</td>
                  <td className="py-2">
                    {tr(
                      service.kind === "app"
                        ? "stacks.services.kind.app"
                        : "stacks.services.kind.service",
                    )}
                  </td>
                  <td className="py-2">
                    {service.state ? (
                      <Badge variant={service.running ? "default" : "outline"}>
                        {service.state}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">
                        {tr("stacks.services.unreported")}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {service.memoryBytes === undefined
                      ? ""
                      : formatBytes(service.memoryBytes)}
                  </td>
                  <td className="py-2">{service.restarts ?? ""}</td>
                  <td
                    className="max-w-64 truncate py-2 font-mono text-xs"
                    title={service.digest ?? service.image}
                  >
                    {service.digest ?? service.image ?? service.app ?? ""}
                  </td>
                  <td className="py-2">
                    {canWrite ? (
                      <div className="flex justify-end gap-1">
                        {(["restart", "stop", "start"] as const).map(
                          (action) => (
                            <Button
                              key={action}
                              size="sm"
                              variant="minimal"
                              disabled={busy}
                              data-testid={`stack-service-${service.name}-${action}`}
                              onClick={() =>
                                void verb.run(service.name, action)
                              }
                            >
                              {tr(VERB_LABELS[action])}
                            </Button>
                          ),
                        )}
                        <Button
                          size="sm"
                          variant="minimal"
                          disabled={busy}
                          data-testid={`stack-service-${service.name}-logs`}
                          onClick={() => void logs.run(service.name)}
                        >
                          {tr("stacks.services.logs")}
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {logsOf ? (
        <StackServiceLogs
          target={props.target}
          service={logsOf.service}
          request={logsOf.request}
          onClose={() => setLogsOf(undefined)}
        />
      ) : null}
    </div>
  );
};

export default StackServicesTab;

/**
 * The label of each per-service verb, spelled out so every key is one the
 * i18n check can see.
 */
const VERB_LABELS = {
  restart: "stacks.services.restart",
  stop: "stacks.services.stop",
  start: "stacks.services.start",
} as const;
