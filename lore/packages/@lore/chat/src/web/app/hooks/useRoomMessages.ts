import { DateTimeProvider } from "alepha/datetime";
import {
  type InfiniteQueryData,
  useClient,
  useInfiniteQuery,
  useInject,
  useQueryClient,
} from "alepha/react";
import { useMemo } from "react";

import type { ChatMessageController } from "../../../api/controllers/ChatMessageController.ts";
import type {
  ChatMessageResource,
  ChatServerFrame,
} from "../../../schemas/index.ts";

/**
 * One page of a room, newest first, as `listChatMessages` answers it.
 */
interface MessagePage {
  items: ChatMessageResource[];
  hasMore: boolean;
}

type MessagePages = InfiniteQueryData<MessagePage, string | undefined>;

/**
 * The messages of the open room (#E161, #Q3929), oldest first, as the
 * conversation draws them.
 *
 * Read page by page under one key, newest page first, each next page older
 * than the last (`before` the oldest id held). A live frame for this room is
 * written into that same cache entry, so a refetch and a frame never draw
 * two versions of one message; `resync` invalidates the key after a
 * reconnection, and what was sent while the socket was down is read from the
 * database, never replayed.
 */
export const useRoomMessages = (projectId: number, roomId?: string) => {
  const api = useClient<ChatMessageController>();
  const queries = useQueryClient();
  const dateTime = useInject(DateTimeProvider);
  const key = ["chat-messages", projectId, roomId];

  const query = useInfiniteQuery<MessagePage, string | undefined>(
    {
      key,
      enabled: !!roomId,
      handler: (_context, before) =>
        api.listChatMessages({
          params: { projectId, roomId: roomId! },
          query: before ? { before } : {},
        }),
      initialPageParam: undefined,
      getNextPageParam: (last) =>
        last.hasMore ? last.items.at(-1)?.id : undefined,
    },
    [api, projectId, roomId],
  );

  const messages = useMemo(() => {
    const byId = new Map<string, ChatMessageResource>();
    for (const page of query.pages) {
      for (const message of page.items) byId.set(message.id, message);
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [query.pages]);

  /**
   * Write into the newest page, or change a message wherever it is held.
   */
  const write = (change: (pages: MessagePage[]) => MessagePage[]) =>
    queries.setData<MessagePages | undefined>(key, (data) =>
      data ? { ...data, pages: change(data.pages) } : data,
    );

  const add = (message: ChatMessageResource) =>
    write((pages) => {
      const held = pages.some((page) =>
        page.items.some((it) => it.id === message.id),
      );
      if (held) {
        return pages.map((page) => ({
          ...page,
          items: page.items.map((it) => (it.id === message.id ? message : it)),
        }));
      }
      const [first, ...rest] = pages;
      return first
        ? [{ ...first, items: [message, ...first.items] }, ...rest]
        : pages;
    });

  /**
   * Fold a live frame into what the room shows. Frames of another room or
   * project are not this hook's.
   */
  const apply = (frame: ChatServerFrame) => {
    if (!roomId || frame.projectId !== projectId || frame.roomId !== roomId) {
      return;
    }
    if (frame.type === "message.created" || frame.type === "message.updated") {
      add(frame.message);
    } else if (frame.type === "message.deleted") {
      const deletedAt = dateTime.nowISOString();
      write((pages) =>
        pages.map((page) => ({
          ...page,
          items: page.items.map((it) =>
            it.id === frame.messageId
              ? { ...it, body: "", mentions: [], references: [], deletedAt }
              : it,
          ),
        })),
      );
    }
  };

  return {
    messages,
    hasMore: query.hasMore,
    loading: query.loading || query.loadingMore,
    loadOlder: query.loadMore,
    resync: () => queries.invalidate(key),
    apply,
    /**
     * A message this tab just sent, shown before its frame arrives.
     */
    add,
  };
};
