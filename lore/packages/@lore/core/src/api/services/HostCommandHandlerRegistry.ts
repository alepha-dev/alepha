import { AlephaError } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import type { Host } from "../entities/hosts.ts";
import type { HostCommandResource } from "../schemas/hostCommandResourceSchema.ts";

/**
 * Who queues a host command of a kind core does not handle itself (#E166,
 * folio #F1537).
 *
 * `POST /hosts/:hostId/commands` is one endpoint with one discriminated
 * union: core answers `upgrade`, and the app, backup, logs and deploy kinds
 * are Ship's, which registers one handler for them and enforces its own
 * `ship` capability there. A kind nobody registered is refused with a 400,
 * never queued.
 */
export class HostCommandHandlerRegistry {
  protected readonly handlers = new Map<string, HostCommandHandler>();

  public register(kinds: readonly string[], handler: HostCommandHandler): void {
    for (const kind of kinds) {
      if (this.handlers.has(kind)) {
        throw new AlephaError(`Host command '${kind}' already has a handler`);
      }
      this.handlers.set(kind, handler);
    }
  }

  public has(kind: string): boolean {
    return this.handlers.has(kind);
  }

  public async enqueue(
    input: HostCommandHandlerInput,
  ): Promise<HostCommandResource> {
    const handler = this.handlers.get(input.body.kind);
    if (!handler) {
      throw new BadRequestError(
        `This Lore cannot send a host a "${input.body.kind}" command`,
      );
    }
    return handler(input);
  }
}

export interface HostCommandHandlerInput {
  host: Host;
  body: { kind: string } & Record<string, unknown>;
  user: UserAccountToken;
}

export type HostCommandHandler = (
  input: HostCommandHandlerInput,
) => Promise<HostCommandResource>;
