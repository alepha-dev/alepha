import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import { currentProjectAtom, type I18n, sidePanelAtom } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { MessageCircle } from "lucide-react";

import { assistantOpenAtom } from "./assistantOpenAtom.ts";
import { useAssistantStatus } from "./useAssistantStatus.ts";

/**
 * The header's assistant toggle (#Q3211), registered on core's
 * `ShellExtensionRegistry`: shown only inside a project (#Q3235, owner's
 * call: project pages only for now), and only once `aiAssistantStatus` says
 * the assistant answers, hidden while loading and on error.
 */
const AssistantHeaderButton = () => {
  const { tr } = useI18n<I18n, "en">();
  const enabled = useAssistantStatus();
  const [open, setOpen] = useStore(assistantOpenAtom);
  const [project] = useStore(currentProjectAtom);
  const [, setSidePanel] = useStore(sidePanelAtom);
  const label = tr("assistant.open");

  if (!enabled || project?.id === undefined) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="minimal"
            size="icon"
            aria-label={label}
            aria-pressed={open}
            data-testid="assistant-button"
            // The cluster's `gap-1` reads as cramped against the round
            // account avatar that follows (#Q3235).
            className="me-1.5"
            onClick={() => {
              // One panel on the right at a time (#Q4515): opening the
              // assistant closes a watched job.
              if (!open) setSidePanel({ panel: "assistant" });
              setOpen(!open);
            }}
          >
            {/* A chat bubble (#Q4562): the jobs button beside it is a
                robot, and a sparkle read as a gadget. */}
            <MessageCircle className="size-4" />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

export default AssistantHeaderButton;
