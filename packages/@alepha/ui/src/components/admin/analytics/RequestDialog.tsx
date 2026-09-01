import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import type { AdminAnalyticsQuery } from "alepha/api/analytics";
import { useI18n } from "alepha/react/i18n";
import { Copy } from "lucide-react";
import { useState } from "react";

export interface RequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The endpoint that answers, from the transport.
   *
   * Not derived from the dataset name here: on a scoped surface the URL is
   * where the scope is stated, and this dialog is the design's honesty check.
   * A hardcoded admin path would quietly claim the wrong thing.
   */
  path: string;
  body: AdminAnalyticsQuery;
}

/**
 * The request the panel would send, verbatim.
 *
 * This is the design's honesty check: everything the UI can express is one
 * JSON object, and every key in it is in the dataset's published schema. A
 * control the request body cannot represent is a control that does not belong
 * in the panel.
 */
export const RequestDialog = (props: RequestDialogProps) => {
  const { tr } = useI18n();
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(props.body, null, 2);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);
        if (!open) setCopied(false);
      }}
    >
      <DialogContent className="flex max-h-[78vh] flex-col gap-3 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {tr("admin.analytics.requestTitle", { default: "Request body" })}
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">
            POST {props.path}
          </DialogDescription>
        </DialogHeader>
        <pre className="bg-background ring-border min-h-0 flex-1 overflow-auto rounded-lg p-3.5 font-mono text-[12px] leading-relaxed ring-1 ring-inset">
          {json}
        </pre>
        <DialogFooter className="items-center">
          <span className="text-muted-foreground flex-1 text-[11.5px]">
            {tr("admin.analytics.requestHonesty", {
              default: "Every key here is in the dataset's published schema.",
            })}
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => props.onOpenChange(false)}
          >
            {tr("admin.analytics.close", { default: "Close" })}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(json).catch(() => {});
              setCopied(true);
            }}
          >
            <Copy className="size-3.5" />
            {copied
              ? tr("admin.analytics.copied", { default: "Copied" })
              : tr("admin.analytics.copy", { default: "Copy" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
