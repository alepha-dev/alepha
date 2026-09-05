import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useState } from "react";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * `useDialog` is the reason this page exists as much as `useToast` is.
 *
 * `window.confirm`, `window.alert` and `window.prompt` are banned in this
 * codebase: they block the event loop, cannot be styled, and are unusable in
 * SSR. The imperative API here replaces all three and returns a promise, so
 * calling code keeps reading top to bottom.
 */
const Feedback = () => {
  const toast = useToast();
  const dialog = useDialog();
  const [answer, setAnswer] = useState<string>("nothing yet");

  return (
    <BlockPage
      title="Toasts and dialogs"
      description="Transient feedback and blocking questions."
    >
      <Specimen
        title="Toast tones"
        description="Stacked and auto-dismissed."
        inline
      >
        <Button onClick={() => toast.success("Settings saved")}>Success</Button>
        <Button variant="secondary" onClick={() => toast.info("Build queued")}>
          Info
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.warning("Token expires in 3 days")}
        >
          Warning
        </Button>
        <Button
          variant="destructive"
          onClick={() => toast.error("Deploy failed")}
        >
          Error
        </Button>
      </Specimen>

      <Specimen title="Dialogs" description="Each returns a promise." inline>
        <Button
          onClick={async () => {
            const ok = await dialog.confirm({
              title: "Delete project",
              description:
                "This permanently removes the project and its history.",
              confirmLabel: "Delete",
              destructive: true,
            });
            setAnswer(ok ? "confirmed" : "cancelled");
          }}
        >
          Confirm (destructive)
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            await dialog.alert({
              title: "Deploy finished",
              description: "Twelve files uploaded to the edge.",
            });
            setAnswer("acknowledged");
          }}
        >
          Alert
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            const value = await dialog.prompt({
              title: "Rename project",
              description: "Pick something short.",
            });
            setAnswer(value === null ? "cancelled" : `renamed to "${value}"`);
          }}
        >
          Prompt
        </Button>
        <span className="text-muted-foreground text-xs">
          Last answer: <code className="font-mono">{answer}</code>
        </span>
      </Specimen>
    </BlockPage>
  );
};

export default Feedback;
