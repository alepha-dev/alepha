import { Button } from "@alepha/ui";
import { AiChat, type AiChatSuggestion } from "@alepha/ui/ai";
import { useChatToolSummary } from "@lore/chat/web";
import {
  AssistantSuggestionRegistry,
  currentProjectAtom,
  type I18n,
  loreDocsUrl,
} from "@lore/core/web";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouterState } from "alepha/react/router";
import { CircleHelp } from "lucide-react";

import { assistantConfirmCards } from "./assistantConfirmCards.ts";
import { assistantOpenAtom } from "./assistantOpenAtom.ts";
import AssistantReplyLink from "./AssistantReplyLink.tsx";
import { useAssistantInvalidates } from "./useAssistantInvalidates.ts";
import { useAssistantModel, useAssistantStatus } from "./useAssistantStatus.ts";
import { useAssistantToolLabel } from "./useAssistantToolLabel.ts";

/**
 * Lore's assistant (#Q3211), mounted once at the layout's root through
 * core's `ShellExtensionRegistry`, so the conversation outlives every page.
 *
 * A card floating over the page's bottom corner (`AiChat`'s `floating`
 * mode, #Q4269, the owner's call over the dock): the page under it stays
 * usable, the header names the agent and the model that answers, and it
 * minimizes into a pill, expands to full screen or closes. Nothing renders
 * until the server says the assistant answers, nor outside a project
 * (#Q3235): project pages only, for now.
 */
const AssistantPanel = () => {
  const { tr } = useI18n<I18n, "en">();
  const enabled = useAssistantStatus();
  const model = useAssistantModel();
  const [open, setOpen] = useStore(assistantOpenAtom);
  const [project] = useStore(currentProjectAtom);
  const toolLabel = useAssistantToolLabel();
  // The rooms' summary, so a run reads the same in the panel (#Q4212).
  const toolSummary = useChatToolSummary();
  const refresh = useAssistantInvalidates();
  const registry = useInject(AssistantSuggestionRegistry);
  const routerState = useRouterState();

  if (!enabled || project?.id === undefined) {
    return null;
  }

  // The open page's own prompts (#Q3585), registered by the module that owns
  // it; a page nobody registered keeps the generic three.
  const keys = registry.suggestionsFor(
    (routerState.layers ?? []).flatMap((layer) =>
      layer.route?.name ? [layer.route.name] : [],
    ),
  ) ?? [
    "assistant.suggest.open",
    "assistant.suggest.epic",
    "assistant.suggest.file",
  ];
  const suggestions: AiChatSuggestion[] = keys.map((key) => ({
    // A registered key is a plain string; the catalogue has every one.
    label: tr(key as Parameters<typeof tr>[0]),
  }));

  return (
    <AiChat
      mode="floating"
      assistant="lore"
      open={open}
      onOpenChange={setOpen}
      title={tr("assistant.title")}
      subtitle={model}
      suggestions={suggestions}
      toolLabel={toolLabel}
      toolSummary={toolSummary}
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
