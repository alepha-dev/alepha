import { AlephaError } from "alepha";
import { ActorProvider, type ActorRequest } from "alepha/actor";

/**
 * An actor store that is down: every call is recorded, then fails with
 * `error`, which a spec replaces to play contention.
 */
export class BrokenActorProvider extends ActorProvider {
  public error: Error = new AlephaError("actor store down");
  public calls: ActorRequest[] = [];

  public override async execute(request: ActorRequest): Promise<unknown> {
    this.calls.push(request);
    throw this.error;
  }
}
