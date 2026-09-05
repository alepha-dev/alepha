import * as React from "react";

void React;

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import type { JobExecutionResource } from "alepha/api/jobs";
import { useI18n } from "alepha/react/i18n";

export interface AdminJobsPayloadDialogProps {
  /**
   * The execution whose payload to show, or `null` when the dialog is
   * closed.
   */
  execution: JobExecutionResource | null;
  onClose: () => void;
}

/**
 * The payload of one execution, pretty-printed.
 *
 * A job that reschedules itself through stages carries the stage in its
 * payload, so this is the one place the admin can read which stage a parked
 * row is on.
 */
export const AdminJobsPayloadDialog = (props: AdminJobsPayloadDialogProps) => {
  const { tr } = useI18n();
  const execution = props.execution;

  return (
    <Dialog
      open={execution != null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("admin.jobs.payloadTitle", { default: "Payload" })}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {execution?.id}
          </DialogDescription>
        </DialogHeader>
        <pre className="bg-muted max-h-[60vh] overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed">
          {JSON.stringify(execution?.payload ?? null, null, 2)}
        </pre>
      </DialogContent>
    </Dialog>
  );
};
