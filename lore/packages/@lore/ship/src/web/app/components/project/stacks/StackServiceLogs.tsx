import { Button, Card, CardContent, CardHeader, CardTitle } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect } from "react";

import type { StackDeployController } from "../../../../../api/controllers/StackDeployController.ts";
import type { StackTarget } from "./stackTarget.ts";

export interface StackServiceLogsProps {
  target: StackTarget;
  service: string;
  request: string;
  onClose: () => void;
}

/**
 * The answer to one logs request: re-read every two seconds until the machine
 * has uploaded the lines or said why it could not, then the poll stops.
 */
const StackServiceLogs = (props: StackServiceLogsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<StackDeployController>();
  const { data, refetch } = useQuery(
    {
      key: ["stack-logs", props.target.projectId, props.request],
      handler: async () =>
        await api.readStackLogs({
          params: { ...props.target, request: props.request },
        }),
    },
    [props.request],
  );

  const settled =
    data?.status === "done" ||
    data?.status === "failed" ||
    data?.status === "expired";
  // The poll, and it stops itself once the answer is in.
  useEffect(() => {
    if (settled) {
      return;
    }
    const timer = setInterval(() => refetch(), 2_000);
    return () => clearInterval(timer);
  }, [settled, refetch]);

  return (
    <Card data-testid="stack-service-logs">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          {tr("stacks.logs.title", { args: [props.service] })}
        </CardTitle>
        <Button size="sm" variant="minimal" onClick={props.onClose}>
          {tr("stacks.logs.close")}
        </Button>
      </CardHeader>
      <CardContent>
        {!settled ? (
          <p className="text-muted-foreground text-sm">
            {tr("stacks.logs.waiting")}
          </p>
        ) : data?.status !== "done" ? (
          <p className="text-muted-foreground text-sm">
            {tr("stacks.logs.failed", {
              args: [data?.reason ?? data?.status ?? ""],
            })}
          </p>
        ) : (data.lines ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {tr("stacks.logs.empty")}
          </p>
        ) : (
          <pre className="max-h-96 overflow-auto font-mono text-xs whitespace-pre-wrap">
            {(data.lines ?? []).map((line) => line.raw).join("\n")}
          </pre>
        )}
      </CardContent>
    </Card>
  );
};

export default StackServiceLogs;
