import { $inject, Alepha } from "alepha";

import { HostSocketController } from "../controllers/HostSocketController.ts";
import type { Host } from "../entities/hosts.ts";
import type { HostServerFrame } from "../schemas/hostServerFrameSchema.ts";
import { HostCommandTransport } from "./HostCommandTransport.ts";
import { HostService } from "./HostService.ts";

/**
 * The real transport: a frame goes out over the host's open websocket.
 *
 * `emit({ roomId })` is the one addressing that works on both runtimes; on
 * Cloudflare it is a stub call to the Durable Object holding the socket,
 * which bills a request whether or not a socket is there. So the row's
 * liveness stamps are consulted first, from the row the caller already
 * holds (no database read on this path), and a host the stamps say is
 * offline gets no call at all: the command stays `pending` and the
 * reconciliation on the machine's next `hello` delivers it.
 *
 * This is the transport for the HTTP side of Lore (enqueue from a page,
 * switch changes). The socket handler itself never goes through here: inside
 * the Durable Object it answers with `reply()`, a local fan-out, because an
 * `emit()` from inside the object would be the object calling its own stub.
 *
 * Substituted for `HostCommandTransport` in `main.server.ts`.
 */
export class WebSocketHostCommandTransport extends HostCommandTransport {
  protected readonly alepha = $inject(Alepha);
  protected readonly service = $inject(HostService);

  override async push(host: Host, frame: HostServerFrame): Promise<boolean> {
    if (!this.service.isOnline(host)) {
      return false;
    }
    // Resolved at call time rather than injected as a field: the socket
    // controller injects the command service, which injects this transport,
    // and a field-level inject here would close that cycle at construction.
    const controller = this.alepha.inject(HostSocketController);
    await controller.socket.emit({ roomId: host.id, message: frame });
    return true;
  }
}
