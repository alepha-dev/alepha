import {
  Button,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui";
import { currentProjectAtom, type I18n, sidePanelAtom } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { MessageCircle } from "lucide-react";

import {
  assistantActivityAtom,
  assistantOpenAtom,
} from "./assistantOpenAtom.ts";
import { useAssistantStatus } from "./useAssistantStatus.ts";

/**
 * What the closed chat's button says beside "Talk to Lore".
 */
const ACTIVITY_LABEL = {
  running: "assistant.activity.running",
  waiting: "assistant.activity.waiting",
  unread: "assistant.activity.unread",
} as const;

/**
 * The header's assistant toggle (#Q3211), registered on core's
 * `ShellExtensionRegistry`: shown only inside a project (#Q3235, owner's
 * call: project pages only for now), and only once `aiAssistantStatus` says
 * the assistant answers, hidden while loading and on error.
 *
 * Closing the chat never stops Lore (#Q4563), so while it is closed the
 * button says what she is doing, as the jobs robot beside it does: a ring
 * turning around the bubble while she answers, then a pulsing dot once the
 * answer waits to be read (a warning dot while a write waits for approval). The
 * tooltip says it in words. No motion under reduced motion. The floating
 * card folds into this button when it closes.
 */
const AssistantHeaderButton = () => {
  const { tr } = useI18n<I18n, "en">();
  const enabled = useAssistantStatus();
  const [open, setOpen] = useStore(assistantOpenAtom);
  const [activity] = useStore(assistantActivityAtom);
  const [project] = useStore(currentProjectAtom);
  const [, setSidePanel] = useStore(sidePanelAtom);

  if (!enabled || project?.id === undefined) {
    return null;
  }

  // Open, the panel itself shows what Lore does.
  const shown = open ? "idle" : (activity ?? "idle");
  const label =
    shown === "idle"
      ? tr("assistant.open")
      : `${tr("assistant.open")} · ${tr(ACTIVITY_LABEL[shown])}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="minimal"
            size="icon"
            aria-label={label}
            aria-pressed={open}
            data-testid={AssistantHeaderButton.TEST_ID}
            data-activity={shown}
            // The cluster's `gap-1` reads as cramped against the round
            // account avatar that follows (#Q3235).
            className="relative me-1.5"
            onClick={() => {
              // One panel on the right at a time (#Q4515): opening the
              // assistant closes a watched job.
              if (!open) setSidePanel({ panel: "assistant" });
              setOpen(!open);
            }}
          >
            {/* A chat bubble (#Q4562): the jobs button beside it is a
                robot, and a sparkle read as a gadget. */}
            <span className="relative grid size-4 place-items-center">
              <MessageCircle className="size-4" />
              {shown === "running" && (
                <svg
                  className="text-primary pointer-events-none absolute -inset-1.5 size-7 motion-safe:animate-spin"
                  viewBox="0 0 36 36"
                  aria-hidden="true"
                  data-testid="assistant-button-ring"
                >
                  <circle
                    cx="18"
                    cy="18"
                    r="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray="28 100"
                  />
                </svg>
              )}
            </span>
            {(shown === "unread" || shown === "waiting") && (
              <span
                aria-hidden="true"
                data-testid="assistant-button-dot"
                className={cn(
                  "ring-background absolute top-1 right-1 size-2 rounded-full ring-2",
                  shown === "waiting" ? "bg-warning" : "bg-primary",
                )}
              >
                {/* A halo pulsing out of it, so the eye finds it. */}
                <span
                  className={cn(
                    "absolute inset-0 rounded-full opacity-75 motion-safe:animate-ping",
                    shown === "waiting" ? "bg-warning" : "bg-primary",
                  )}
                />
              </span>
            )}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

/**
 * The button's test id, which the chat's fold also finds it by.
 */
AssistantHeaderButton.TEST_ID = "assistant-button";

export default AssistantHeaderButton;
