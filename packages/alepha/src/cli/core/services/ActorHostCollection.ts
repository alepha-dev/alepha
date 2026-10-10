import { AlephaError, type Alepha } from "alepha";
import type { ActorHostDeclaration, ActorHostRegistry } from "alepha/actor";

import { actorHostDeclarationSchema } from "../schemas/actorHostDeclarationSchema.ts";
/**
 * Collect serializable declarations from the user's existing graph by name.
 * Build probes can have a different class identity from the CLI container.
 */
export class ActorHostCollection {
  public collect(app?: Alepha): ActorHostDeclaration[] {
    if (!app) return [];
    let registry: ActorHostRegistry;
    try {
      registry = app.inject<ActorHostRegistry>("ActorHostRegistry");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Service not found: ActorHostRegistry"
      )
        return [];
      throw error;
    }
    const hosts = registry
      .list()
      .map((host) => actorHostDeclarationSchema.parse(host));
    const names = new Set<string>();
    const bindings = new Set<string>();
    for (const host of hosts) {
      if (names.has(host.exportName) || bindings.has(host.binding))
        throw new AlephaError("Conflicting Durable Object host declarations");
      names.add(host.exportName);
      bindings.add(host.binding);
    }
    return hosts;
  }
}
