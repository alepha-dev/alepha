import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Sparkles } from "lucide-react";

import { assistantOpenAtom } from "./assistantOpenAtom.ts";
import { useAssistantStatus } from "./useAssistantStatus.ts";

/**
 * The header's assistant toggle (#Q3211), registered on core's
 * `ShellExtensionRegistry`: shown only once `aiAssistantStatus` says the
 * assistant answers, hidden while loading and on error.
 */
const AssistantHeaderButton = () => {
  const { tr } = useI18n<I18n, "en">();
  const enabled = useAssistantStatus();
  const [open, setOpen] = useStore(assistantOpenAtom);
  const label = tr("assistant.open");

  if (!enabled) {
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
            onClick={() => setOpen(!open)}
          >
            <Sparkles className="size-4" />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

export default AssistantHeaderButton;
