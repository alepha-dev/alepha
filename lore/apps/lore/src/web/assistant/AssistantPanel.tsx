import { Button } from "@alepha/ui";
import { AiChat, type AiChatSuggestion } from "@alepha/ui/ai";
import { currentProjectAtom, type I18n, loreDocsUrl } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { CircleHelp } from "lucide-react";

import { assistantConfirmCards } from "./assistantConfirmCards.ts";
import { assistantOpenAtom } from "./assistantOpenAtom.ts";
import AssistantReplyLink from "./AssistantReplyLink.tsx";
import { useAssistantInvalidates } from "./useAssistantInvalidates.ts";
import { useAssistantStatus } from "./useAssistantStatus.ts";
import { useAssistantToolLabel } from "./useAssistantToolLabel.ts";

/**
 * Lore's assistant (#Q3211), mounted once at the layout's root through
 * core's `ShellExtensionRegistry`, so the conversation outlives every page.
 *
 * From 1024px up it docks beside the page (`AiChat`'s `auto` mode, into the
 * layout's `AiChatDockSlot`) and folds into a pill; narrower, it is a
 * drawer. Nothing renders until the server says the assistant answers, nor
 * outside a project (#Q3235): project pages only, for now.
 */
const AssistantPanel = () => {
  const { tr } = useI18n<I18n, "en">();
  const enabled = useAssistantStatus();
  const [open, setOpen] = useStore(assistantOpenAtom);
  const [project] = useStore(currentProjectAtom);
  const toolLabel = useAssistantToolLabel();
  const refresh = useAssistantInvalidates();

  if (!enabled || project?.id === undefined) {
    return null;
  }

  const suggestions: AiChatSuggestion[] = [
    { label: tr("assistant.suggest.open") },
    { label: tr("assistant.suggest.epic") },
    { label: tr("assistant.suggest.file") },
  ];

  return (
    <AiChat
      mode="auto"
      assistant="lore"
      open={open}
      onOpenChange={setOpen}
      title={tr("assistant.title")}
      suggestions={suggestions}
      toolLabel={toolLabel}
      confirmCards={assistantConfirmCards}
      invalidates={refresh.invalidates}
      onToolsRan={refresh.onToolsRan}
      renderLink={(link) => (
        <AssistantReplyLink href={link.href}>
          {link.children}
        </AssistantReplyLink>
      )}
      headerActions={
        <Button
          size="icon-sm"
          variant="minimal"
          aria-label={tr("assistant.help")}
          href={loreDocsUrl("agents-assistant")}
          target="_blank"
          rel="noopener noreferrer"
        >
          <CircleHelp className="size-4" />
        </Button>
      }
    />
  );
};

export default AssistantPanel;
