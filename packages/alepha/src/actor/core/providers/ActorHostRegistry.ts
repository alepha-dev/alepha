import { AlephaError } from "alepha";

import type { ActorHostDeclaration } from "../interfaces/ActorHostDeclaration.ts";
/**
 * Runtime-neutral native-host declarations, visible without starting the app.
 */
export class ActorHostRegistry {
  public static readonly actor: ActorHostDeclaration = Object.freeze({
    exportName: "AlephaActorDurableObject",
    module: "alepha/actor",
    moduleExport: "AlephaActorDurableObject",
    binding: "ALEPHA_ACTOR",
    backend: "sqlite",
  });
  protected readonly hosts = new Map<string, ActorHostDeclaration>();
  public register(host: ActorHostDeclaration): void {
    for (const existing of this.hosts.values()) {
      if (
        existing.exportName === host.exportName ||
        existing.binding === host.binding
      ) {
        if (
          (
            [
              "exportName",
              "module",
              "moduleExport",
              "binding",
              "backend",
            ] as const
          ).some((key) => existing[key] !== host[key])
        )
          throw new AlephaError("Conflicting Durable Object host declaration");
        return;
      }
    }
    if (
      ![host.exportName, host.moduleExport, host.binding].every(
        (name) =>
          typeof name === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name),
      ) ||
      !host.module ||
      !["sqlite", "kv"].includes(host.backend)
    )
      throw new AlephaError("Invalid Durable Object host declaration");
    this.hosts.set(
      host.exportName,
      Object.freeze({
        exportName: host.exportName,
        module: host.module,
        moduleExport: host.moduleExport,
        binding: host.binding,
        backend: host.backend,
      }),
    );
  }
  public list(): ActorHostDeclaration[] {
    return [...this.hosts.values()].map((host) => ({ ...host }));
  }
}
