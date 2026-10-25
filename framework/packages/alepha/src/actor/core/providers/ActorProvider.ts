import { AlephaError } from "alepha";

import type { ActorRequest } from "../interfaces/ActorInterfaces.ts";

/**
 * Actor snapshot transport. Browser and native execution is unsupported.
 */
export class ActorProvider {
  public async execute(_request: ActorRequest): Promise<unknown> {
    throw new AlephaError("Actors require a server runtime");
  }
}
