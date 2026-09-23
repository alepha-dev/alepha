import { Button, useDialog } from "@alepha/ui";
import { z } from "alepha";
import { useState } from "react";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * `useDialog` replaces `window.confirm` / `alert` / `prompt`, which are banned
 * here: they block the event loop, cannot be styled, and do not exist during
 * SSR. Each call returns a promise, so the calling code still reads top to
 * bottom.
 */
/*
 * `clearable: false` on the four texts: a dialog always has them, so an empty
 * knob is not a state worth a button. They are optional only because
 * `.default()` makes them so, which is what put a (x) on each.
 */
const KNOBS = z.object({
  title: z
    .string()
    .default("Delete project")
    .meta({ title: "Title", $control: { clearable: false } }),
  description: z
    .string()
    .default("This permanently removes the project and its history.")
    .meta({ title: "Description", $control: { clearable: false } }),
  confirmLabel: z
    .string()
    .default("Delete")
    .meta({ title: "Confirm label", $control: { clearable: false } }),
  cancelLabel: z
    .string()
    .default("Cancel")
    .meta({ title: "Cancel label", $control: { clearable: false } }),
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
              intent={v.destructive ? "danger" : "primary"}
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
              variant="solid"
              intent="none"
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
              variant="outlined"
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
