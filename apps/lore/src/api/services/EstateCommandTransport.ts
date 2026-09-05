import type { Estate } from "../entities/estates.ts";
import type { EstateServerFrame } from "../schemas/estateServerFrameSchema.ts";

/**
 * The seam between the queue and the wire.
 *
 * `EstateCommandService` decides WHAT to push and records what became of it;
 * this decides whether it CAN be pushed right now. The queue is built and
 * tested against this class alone, with the websocket endpoint (#1782)
 * substituting the real transport, so the command table never imports
 * `alepha/websocket` and a spec never needs a socket.
 *
 * This default reaches nothing: every push answers `false`, the command
 * stays `pending`, and the reconciliation on the machine's next connect is
 * what delivers it. That is the correct behaviour of a Lore with no
 * websocket wired, not a stub to be embarrassed about.
 */
export class EstateCommandTransport {
  /**
   * Push one frame to one estate's open connection.
   *
   * Takes the row rather than an id: every caller already holds it, and the
   * real transport decides from its liveness stamps whether there is a
   * socket to reach at all, so the push path costs no database read.
   *
   * `true` means the frame was handed to a live socket, and the caller marks
   * the command `sent`. `false` means no socket held that estate, and the
   * command stays `pending` for the reconciliation. Never throws for
   * "offline": that is the common case, not an error.
   */
  async push(estate: Estate, frame: EstateServerFrame): Promise<boolean> {
    void estate;
    void frame;
    return false;
  }
}
