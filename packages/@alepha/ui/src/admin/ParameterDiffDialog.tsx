import * as React from "react";

void React;

import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { type ReactNode, useMemo } from "react";

import { diffLines } from "./diff-lines.ts";

export interface ParameterDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /**
   * Overrides the default "Changes compared to the previous version." line.
   */
  description?: ReactNode;
  /**
   * Content of the previous version (the "before" side of the diff).
   */
  previous: unknown;
  /**
   * Content of this version (the "after" side of the diff).
   */
  current: unknown;
  /**
   * When set, renders a footer with a Cancel button and a confirm button.
   * Turns the read-only diff viewer into a confirmation dialog (e.g. factory
   * reset, where the diff previews what the reset will change).
   */
  confirm?: {
    label: string;
    onConfirm: () => void | Promise<void>;
    loading?: boolean;
    destructive?: boolean;
  };
}

/**
 * Dialog rendering a line-based diff between a version and its predecessor.
 * Added lines are green, removed lines red, unchanged lines muted.
 */
export const ParameterDiffDialog = (props: ParameterDiffDialogProps) => {
  const { tr } = useI18n();
  const lines = useMemo(
    () =>
      diffLines(
        JSON.stringify(props.previous ?? {}, null, 2),
        JSON.stringify(props.current ?? {}, null, 2),
      ),
    [props.previous, props.current],
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{props.title}</DialogTitle>
          <DialogDescription>
            {props.description ??
              tr("admin.parameters.diffDialogDescription", {
                default: "Changes compared to the previous version.",
              })}
          </DialogDescription>
        </DialogHeader>
        <pre className="bg-muted max-h-[60vh] overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed">
          {lines.map((line, index) => (
            <div
              // diff lines are positional
              key={index}
              className={cn(
                "flex gap-2 whitespace-pre-wrap",
                line.type === "add" &&
                  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                line.type === "remove" &&
                  "bg-red-500/10 text-red-700 dark:text-red-400",
                line.type === "same" && "text-muted-foreground",
              )}
            >
              <span aria-hidden className="opacity-60 select-none">
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              </span>
              <span className="flex-1">{line.text}</span>
            </div>
          ))}
        </pre>
        {props.confirm && (
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  {tr("admin.parameters.diffCancel", { default: "Cancel" })}
                </Button>
              }
            />
            <Button
              type="button"
              variant={props.confirm.destructive ? "destructive" : "default"}
              loading={props.confirm.loading}
              onClick={() => props.confirm?.onConfirm()}
            >
              {props.confirm.label}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
