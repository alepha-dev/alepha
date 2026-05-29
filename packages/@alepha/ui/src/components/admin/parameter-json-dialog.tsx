import * as React from "react";

void React;

import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useI18n } from "alepha/react/i18n";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface ParameterJsonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  content: unknown;
}

/**
 * Read-only dialog that pretty-prints a parameter version's content as JSON,
 * with a copy-to-clipboard button.
 */
export const ParameterJsonDialog = (props: ParameterJsonDialogProps) => {
  const { tr } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const json = JSON.stringify(props.content ?? {}, null, 2);

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
      await navigator.clipboard.writeText(json);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error(
        tr("admin.parameters.copyFailed", { default: "Could not copy" }),
      );
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2 pr-6">
            <span className="truncate">{props.title}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={onCopy}
            >
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {tr("admin.parameters.copy", { default: "Copy" })}
            </Button>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {tr("admin.parameters.jsonDialogDescription", {
              default: "Raw JSON content of this parameter version.",
            })}
          </DialogDescription>
        </DialogHeader>
        <pre className="bg-muted max-h-[60vh] overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed">
          {json}
        </pre>
      </DialogContent>
    </Dialog>
  );
};
