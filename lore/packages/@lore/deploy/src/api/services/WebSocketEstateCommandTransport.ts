import { $inject, Alepha } from "alepha";

import { EstateSocketController } from "../controllers/EstateSocketController.ts";
import type { Estate } from "../entities/estates.ts";
import type { EstateServerFrame } from "../schemas/estateServerFrameSchema.ts";
import { EstateCommandTransport } from "./EstateCommandTransport.ts";
import { EstateService } from "./EstateService.ts";

/**
 * The real transport: a frame goes out over the estate's open websocket.
 *
 * `emit({ roomId })` is the one addressing that works on both runtimes; on
 * Cloudflare it is a stub call to the Durable Object holding the socket,
 * which bills a request whether or not a socket is there. So the row's
 * liveness stamps are consulted first, from the row the caller already
 * holds (no database read on this path), and an estate the stamps say is
 * offline gets no call at all: the command stays `pending` and the
 * reconciliation on the machine's next `hello` delivers it.
 *
 * This is the transport for the HTTP side of Lore (enqueue from a page,
 * switch changes). The socket handler itself never goes through here: inside
 * the Durable Object it answers with `reply()`, a local fan-out, because an
 * `emit()` from inside the object would be the object calling its own stub.
 *
 * Substituted for `EstateCommandTransport` in `main.server.ts`.
 */
export class WebSocketEstateCommandTransport extends EstateCommandTransport {
  protected readonly alepha = $inject(Alepha);
  protected readonly service = $inject(EstateService);

  override async push(
    estate: Estate,
    frame: EstateServerFrame,
  ): Promise<boolean> {
    if (!this.service.isOnline(estate)) {
      return false;
    }
    // Resolved at call time rather than injected as a field: the socket
    // controller injects the command service, which injects this transport,
    // and a field-level inject here would close that cycle at construction.
    const controller = this.alepha.inject(EstateSocketController);
    await controller.socket.emit({ roomId: estate.id, message: frame });
    return true;
  }
}
