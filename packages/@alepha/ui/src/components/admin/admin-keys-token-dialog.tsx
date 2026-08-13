import * as React from "react";

void React;

import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useI18n } from "alepha/react/i18n";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface AdminKeysTokenDialogProps {
  /**
   * The freshly minted token, or `null` when the dialog is closed. The
   * server stores only a hash, so this dialog is the single moment the
   * token is ever readable.
   */
  token: string | null;
  onClose: () => void;
}

/**
 * One-time token reveal shown right after an API key is created.
 */
export const AdminKeysTokenDialog = (props: AdminKeysTokenDialogProps) => {
  const { tr } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // Clear the "copied" reset timer on unmount so it can't fire setState on an
  // unmounted component.
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.token ?? "");
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error(tr("admin.keys.copyFailed", { default: "Could not copy" }));
    }
  };

  return (
    <Dialog
      open={props.token != null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("admin.keys.tokenTitle", { default: "API key created" })}
          </DialogTitle>
          <DialogDescription>
            {tr("admin.keys.tokenDescription", {
              default:
                "Copy this token now — it is shown only once and cannot be recovered.",
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2">
          <code className="bg-muted min-w-0 flex-1 break-all rounded-md p-3 font-mono text-xs leading-relaxed">
            {props.token}
          </code>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 shrink-0 p-0"
                    aria-label={tr("admin.keys.copy", { default: "Copy" })}
                    onClick={onCopy}
                  />
                }
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </TooltipTrigger>
              <TooltipContent>
                {tr("admin.keys.copy", { default: "Copy" })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <DialogFooter>
          <Button type="button" onClick={props.onClose}>
            {tr("admin.keys.tokenDone", { default: "Done" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
