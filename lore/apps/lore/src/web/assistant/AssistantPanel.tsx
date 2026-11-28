import { AiChat, type AiChatSuggestion } from "@alepha/ui/ai";
import { useChatToolSummary } from "@lore/chat/web";
import {
  AssistantSuggestionRegistry,
  currentProjectAtom,
  type I18n,
  LoreLogoAnimated,
  sidePanelAtom,
} from "@lore/core/web";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouterState } from "alepha/react/router";
import { useEffect } from "react";

import { assistantConfirmCards } from "./assistantConfirmCards.ts";
import AssistantHeaderButton from "./AssistantHeaderButton.tsx";
import {
  assistantActivityAtom,
  assistantOpenAtom,
} from "./assistantOpenAtom.ts";
import AssistantReplyLink from "./AssistantReplyLink.tsx";
import { useAssistantInvalidates } from "./useAssistantInvalidates.ts";
import { useAssistantStatus } from "./useAssistantStatus.ts";
import { useAssistantToolLabel } from "./useAssistantToolLabel.ts";

/**
 * Lore's assistant (#Q3211), mounted once at the layout's root through
 * core's `ShellExtensionRegistry`, so the conversation outlives every page.
 *
 * A card floating over the page's bottom corner (`AiChat`'s `floating`
 * mode, #Q4269, the owner's call over the dock): the page under it stays
 * usable, it moves by its header, and it expands to full screen or closes.
 * No minimize and no pill, no help link (#Q4563): closing folds the card
 * into the header's chat button and never stops a turn, and that button
 * says what the closed conversation is doing (`assistantActivityAtom`).
 *
 * It is Lore talking, as `@lore` is in Chat (#Q4562): the header says
 * "Lore" beside her animated portrait, with no model named (the operator
 * picks it, the reader need not know), and a new conversation opens on her
 * `listening` mood above the page's prompts. Nothing renders
 * until the server says the assistant answers, nor outside a project
 * (#Q3235): project pages only, for now.
 */
const AssistantPanel = () => {
  const { tr } = useI18n<I18n, "en">();
  const enabled = useAssistantStatus();
  const [open, setOpen] = useStore(assistantOpenAtom);
  const [, setActivity] = useStore(assistantActivityAtom);
  const [project] = useStore(currentProjectAtom);
  const toolLabel = useAssistantToolLabel();
  // The rooms' summary, so a run reads the same in the panel (#Q4212).
  const toolSummary = useChatToolSummary();
  const refresh = useAssistantInvalidates();
  const registry = useInject(AssistantSuggestionRegistry);
  const routerState = useRouterState();
  const [side] = useStore(sidePanelAtom);

  // One panel on the right at a time (#Q4515): a job watched from the
  // header's jobs list takes it, and the assistant gives it up.
  useEffect(() => {
    if (open && side?.panel && side.panel !== "assistant") setOpen(false);
  }, [side?.panel]);

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
      minimizable={false}
      foldTarget={() =>
        document.querySelector(
          `[data-testid="${AssistantHeaderButton.TEST_ID}"]`,
        )
      }
      onActivityChange={setActivity}
      title={tr("assistant.title")}
      icon={
        // Her portrait's canvas lies over the slot, 1.8 times its side, so
        // her wings are drawn whole past it, as `ChatAgentAvatar` lays it.
        <span
          aria-hidden
          className="relative inline-block size-6 shrink-0"
          data-testid="assistant-portrait"
        >
          <LoreLogoAnimated
            portrait
            className="pointer-events-none absolute -inset-[40%] size-[180%]"
          />
        </span>
      }
      emptyHero={
        <div
          aria-hidden
          className="flex justify-center pb-2"
          data-testid="assistant-listening"
        >
          <LoreLogoAnimated mood="listening" className="size-44" />
        </div>
      }
      placeholder={tr("assistant.placeholder")}
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
    />
  );
};

export default AssistantPanel;
