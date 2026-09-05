import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * Toasts are fire-and-forget, so the knobs describe the NEXT one rather than
 * one on screen: pick a tone and a message, press, watch it stack.
 */
const KNOBS = z.object({
  message: z.string().default("Settings saved").meta({ title: "Message" }),
  description: z.string().default("").meta({ title: "Description" }).optional(),
  burst: z
    .enum(["1", "3", "5"])
    .default("1")
    .meta({ title: "How many at once" }),
});

const Toast = () => {
  const toast = useToast();

  const fire = (
    kind: "success" | "info" | "warning" | "error",
    v: { message: string; description?: string; burst: string },
  ) => {
    const n = Number(v.burst);
    for (let i = 0; i < n; i++) {
      const label = n > 1 ? `${v.message} (${i + 1})` : v.message;
      toast[kind](
        label,
        v.description ? { description: v.description } : undefined,
      );
    }
  };

  return (
    <Showcase
      title="Toast"
      description="Transient feedback, stacked and auto-dismissed."
      schema={KNOBS}
      initialValues={{ message: "Settings saved", description: "", burst: "1" }}
      center
    >
      {(v) => (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={() => fire("success", v)}>Success</Button>
          <Button variant="secondary" onClick={() => fire("info", v)}>
            Info
          </Button>
          <Button variant="outline" onClick={() => fire("warning", v)}>
            Warning
          </Button>
          <Button variant="destructive" onClick={() => fire("error", v)}>
            Error
          </Button>
          {/*
            `action` and `duration` are the only other things ToastOptions
            carries. There is no loading toast in this API: the interface is
            deliberately narrow - `show` plus four intents - so a pending state
            is the caller's own affair.
          */}
          <Button
            variant="ghost"
            onClick={() =>
              toast.success(v.message, {
                description: v.description || undefined,
                action: { label: "Undo", onClick: () => toast.info("Undone") },
              })
            }
          >
            With an action
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              toast.info(v.message, {
                description: "Stays for ten seconds.",
                duration: 10_000,
              })
            }
          >
            Long duration
          </Button>
        </div>
      )}
    </Showcase>
  );
};

export default Toast;
