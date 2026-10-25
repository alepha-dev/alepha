import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import { INSPECTOR_PROTOCOL } from "../constants/INSPECTOR_PROTOCOL.ts";
import type { InspectorRun } from "../schemas/InspectorRun.ts";
import { InspectorConnection } from "./InspectorConnection.ts";
import { InspectorRegistry } from "./InspectorRegistry.ts";

/**
 * The inspector protocol, client side: find the apps running on this
 * machine, and talk to one.
 *
 * ```ts
 * const client = alepha.inject(InspectorClient);
 * for (const run of await client.discover()) {
 *   const meta = await client.connect(run).call("metadata");
 * }
 * ```
 *
 * Side-effect free: a tool injects this alone, without the inspector itself.
 * There is no stability promise before alepha 1.0; a run speaking another
 * protocol version is refused rather than guessed at.
 */
export class InspectorClient {
  protected readonly registry = $inject(InspectorRegistry);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Every live run on this machine, and the last dead run of each app while
   * its logs remain. See `InspectorRegistry.discover()`.
   */
  public discover(): Promise<InspectorRun[]> {
    return this.registry.discover();
  }

  /**
   * A connection to one run.
   *
   * @throws AlephaError when the run speaks another protocol version, naming
   * both and the devtools release that matches the run.
   */
  public connect(run: InspectorRun): InspectorConnection {
    if (run.protocol !== INSPECTOR_PROTOCOL) {
      throw new AlephaError(
        `Run "${run.name}" (${run.runId}) speaks inspector protocol ${run.protocol}, this client speaks ${INSPECTOR_PROTOCOL}. Use the tool released with alepha ${run.alephaVersion}, e.g. npx @alepha/devtools@${run.alephaVersion}.`,
      );
    }
    return new InspectorConnection(run, this.registry, this.dateTime);
  }
}
