import type {
  ChatClientFrame,
  ChatServerFrame,
} from "../../../schemas/index.ts";

/**
 * The one chat feed of the page, shared (#E161, #Q3940).
 *
 * `ChatLiveFeed`, mounted once at the layout's root, holds the member's
 * socket and publishes here; the Chat page and the sidebar badge listen.
 * One socket per tab, whatever is open.
 */
export class ChatFeedHub {
  protected readonly frames = new Set<(frame: ChatServerFrame) => void>();
  protected readonly resyncs = new Set<() => void>();
  protected sender?: (frame: ChatClientFrame) => Promise<void>;

  public onFrame(listener: (frame: ChatServerFrame) => void): () => void {
    this.frames.add(listener);
    return () => this.frames.delete(listener);
  }

  /**
   * Every reconnection after the first: what the page shows is read again.
   */
  public onResync(listener: () => void): () => void {
    this.resyncs.add(listener);
    return () => this.resyncs.delete(listener);
  }

  public publish(frame: ChatServerFrame): void {
    for (const listener of this.frames) listener(frame);
  }

  public resync(): void {
    for (const listener of this.resyncs) listener();
  }

  /**
   * Set by the live feed while it holds a socket.
   */
  public connect(
    sender: ((frame: ChatClientFrame) => Promise<void>) | undefined,
  ): void {
    this.sender = sender;
  }

  /**
   * Send a frame if a socket is open; a frame is a hint, so none is
   * queued.
   */
  public send(frame: ChatClientFrame): void {
    void this.sender?.(frame).catch(() => {});
  }
}
