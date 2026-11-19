import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import type { ChatRoomController } from "@lore/chat/api";
import {
  canInProject,
  currentProjectAtom,
  hasCapability,
  type I18n,
} from "@lore/core/web";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Sparkles } from "lucide-react";

import { useAssistantStatus } from "./useAssistantStatus.ts";

/**
 * The header's assistant button (#Q3211, #Q3942): it opens the member's own
 * room with Lore in the Chat page, created on first open. Shown only in a
 * project with chat on that the member may write in, and only once
 * `aiAssistantStatus` says the assistant answers.
 */
const AssistantHeaderButton = () => {
  const { tr } = useI18n<I18n, "en">();
  const enabled = useAssistantStatus();
  const [project] = useStore(currentProjectAtom);
  // Chat's pages are not in this module's router: named by string.
  const router = useRouter<any>();
  const rooms = useClient<ChatRoomController>();
  const label = tr("assistant.room.open");

  const open = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        const room = await rooms.openChatPersonalRoom({
          params: { projectId: project.id },
        });
        await router.push("projectChatRoom", {
          params: { projectSlug: project.slug, room: room.name },
        });
      },
    },
    [rooms, project?.id, router],
  );

  if (
    !enabled ||
    !project ||
    !hasCapability(project, "chat") ||
    !canInProject(project, "chat:write")
  ) {
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
            data-testid="assistant-button"
            disabled={open.loading}
            // The cluster's `gap-1` reads as cramped against the round
            // account avatar that follows (#Q3235).
            className="me-1.5"
            onClick={() => void open.run()}
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
