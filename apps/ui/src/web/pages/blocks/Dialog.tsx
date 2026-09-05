import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { z } from "alepha";
import { useState } from "react";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * `useDialog` replaces `window.confirm` / `alert` / `prompt`, which are banned
 * here: they block the event loop, cannot be styled, and do not exist during
 * SSR. Each call returns a promise, so the calling code still reads top to
 * bottom.
 */
const KNOBS = z.object({
  title: z.string().default("Delete project").meta({ title: "Title" }),
  description: z
    .string()
    .default("This permanently removes the project and its history.")
    .meta({ title: "Description" })
    .optional(),
  confirmLabel: z.string().default("Delete").meta({ title: "Confirm label" }),
  cancelLabel: z.string().default("Cancel").meta({ title: "Cancel label" }),
  destructive: z.boolean().default(true).meta({ title: "Destructive" }),
});

const Dialog = () => {
  const dialog = useDialog();
  const [answer, setAnswer] = useState("nothing yet");

  return (
    <Showcase
      id="blocks/Dialog"
      title="Dialog"
      description="Blocking questions, as promises."
      schema={KNOBS}
      initialValues={{
        title: "Delete project",
        description: "This permanently removes the project and its history.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        destructive: true,
      }}
      center
    >
      {(v) => (
        <div className="flex flex-col items-center gap-4">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              variant={v.destructive ? "destructive" : "default"}
              onClick={async () => {
                const ok = await dialog.confirm({
                  title: v.title,
                  description: v.description || undefined,
                  confirmLabel: v.confirmLabel,
                  cancelLabel: v.cancelLabel,
                  destructive: v.destructive,
                });
                setAnswer(ok ? "confirmed" : "cancelled");
              }}
            >
              confirm
            </Button>

            <Button
              variant="secondary"
              onClick={async () => {
                await dialog.alert({
                  title: v.title,
                  description: v.description || undefined,
                });
                setAnswer("acknowledged");
              }}
            >
              alert
            </Button>

            <Button
              variant="outline"
              onClick={async () => {
                const value = await dialog.prompt({
                  title: v.title,
                  description: v.description || undefined,
                });
                setAnswer(value === null ? "cancelled" : `entered "${value}"`);
              }}
            >
              prompt
            </Button>
          </div>

          <p className="text-muted-foreground text-sm">
            Resolved with: <code className="font-mono">{answer}</code>
          </p>
        </div>
      )}
    </Showcase>
  );
};

export default Dialog;
