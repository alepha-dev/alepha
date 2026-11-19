import { $inject, Alepha } from "alepha";
import { $client } from "alepha/server/links";

import type { ChatMessageController } from "../../../api/controllers/ChatMessageController.ts";
import { chatUnreadAtom } from "../atoms/chatUnreadAtom.ts";

/**
 * Keeps the Chat row's badge current (#E161, #Q3940): one read of the
 * unread counts, at most every half second however many frames arrive.
 */
export class ChatUnread {
  protected readonly alepha = $inject(Alepha);
  protected readonly api = $client<ChatMessageController>();
  protected timer?: ReturnType<typeof setTimeout>;

  public refresh(projectId: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(projectId), 500);
  }

  public async load(projectId: number): Promise<void> {
    const counts = await this.fetch(projectId);
    if (counts) this.alepha.store.set(chatUnreadAtom, counts);
  }

  /**
   * The badge's numbers, muted rooms left out; `undefined` when the read
   * failed, or the reader does not read chat here.
   */
  public async fetch(
    projectId: number,
  ): Promise<
    { projectId: number; total: number; mentions: number } | undefined
  > {
    const page = await this.api
      .getChatUnreadCounts({ params: { projectId } })
      .catch(() => undefined);
    if (!page) return undefined;
    const heard = page.items.filter((row) => row.notifyLevel !== "muted");
    return {
      projectId,
      total: heard.reduce((sum, row) => sum + row.unread, 0),
      mentions: heard.reduce((sum, row) => sum + row.mentions, 0),
    };
  }
}
