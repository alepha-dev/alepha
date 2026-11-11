import * as React from "react";

void React;

import { useI18n } from "alepha/react/i18n";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../core/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { useToast } from "../core/useToast.tsx";

export interface AdminWebhooksSecretDialogProps {
  /**
   * The signing secret just created or rotated, or `null` when closed. The
   * server keeps it encrypted and never shows it again.
   */
  secret: string | null;
  onClose: () => void;
}

/**
 * One-time reveal of a webhook endpoint's signing secret, after creation or
 * rotation. Closing needs the button: a click outside or Escape does not
 * dismiss it, so the secret is not lost by accident.
 */
export const AdminWebhooksSecretDialog = (
  props: AdminWebhooksSecretDialogProps,
) => {
  const { tr } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.secret ?? "");
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error(
        tr("admin.webhooks.copyFailed", { default: "Could not copy" }),
      );
    }
  };

  return (
    <Dialog
      open={props.secret != null}
      // Only the Done button closes it.
      onOpenChange={() => {}}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("admin.webhooks.secretTitle", { default: "Signing secret" })}
          </DialogTitle>
          <DialogDescription>
            {tr("admin.webhooks.secretDescription", {
              default:
                "Copy this secret into the receiver now: it will not be shown again.",
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2">
          <code
            data-testid="webhook-secret"
            className="bg-muted min-w-0 flex-1 rounded-md p-3 font-mono text-xs leading-relaxed break-all"
          >
            {props.secret}
          </code>
          <Button
            type="button"
            variant="outlined"
            size="sm"
            className="h-9 w-9 shrink-0 p-0"
            aria-label={tr("admin.webhooks.copy", { default: "Copy" })}
            onClick={() => void onCopy()}
          >
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" onClick={props.onClose}>
            {tr("admin.webhooks.secretDone", {
              default: "I have copied it",
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
