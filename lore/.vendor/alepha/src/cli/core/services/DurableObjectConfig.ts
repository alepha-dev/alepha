import { $inject, AlephaError } from "alepha";
import type { ActorHostDeclaration } from "alepha/actor";
import { FileSystemProvider } from "alepha/system";
/**
 * Generic local Durable Object bindings and explicit lifecycle provisioning.
 */
export class DurableObjectConfig {
  protected readonly fs = $inject(FileSystemProvider);
  public enhance(
    config: Record<string, any>,
    hosts: ActorHostDeclaration[],
  ): void {
    if (!hosts.length) return;
    const bindings: Array<Record<string, any>> = (
      config.durable_objects?.bindings ?? []
    ).map((binding: any) => ({ ...binding }));
    const names = new Set<string>();
    for (const binding of bindings) {
      if (names.has(binding.name))
        throw new AlephaError("Duplicate Durable Object binding");
      names.add(binding.name);
    }
    for (const host of hosts) {
      const binding = bindings.find((item) => item.name === host.binding);
      if (
        binding &&
        (binding.class_name !== host.exportName ||
          binding.script_name ||
          binding.environment ||
          binding.namespace_id)
      )
        throw new AlephaError(
          `Conflicting Durable Object binding '${host.binding}'`,
        );
      if (!binding)
        bindings.push({ name: host.binding, class_name: host.exportName });
    }
    const exports = { ...config.exports };
    if (config.migrations !== undefined) {
      if (!Array.isArray(config.migrations))
        throw new AlephaError(
          "Durable Object migrations must be an ordered array",
        );
      if (
        Object.values(exports).some(
          (item: any) => item.type === "durable-object",
        )
      )
        throw new AlephaError(
          "Durable Object exports and migrations are mutually exclusive",
        );
      const history = [...config.migrations];
      const tags = new Set<string>();
      const live = new Map<string, string>();
      const seen = new Set<string>();
      for (const step of history) {
        if (typeof step.tag !== "string" || !step.tag || tags.has(step.tag))
          throw new AlephaError(
            "Durable Object migration tags must be nonempty and unique",
          );
        tags.add(step.tag);
        for (const name of this.names(step, "new_classes")) {
          if (live.has(name))
            throw new AlephaError(
              "Durable Object class is redeclared in migration history",
            );
          live.set(name, "kv");
          seen.add(name);
        }
        for (const name of this.names(step, "new_sqlite_classes")) {
          if (live.has(name))
            throw new AlephaError(
              "Durable Object class is redeclared in migration history",
            );
          live.set(name, "sqlite");
          seen.add(name);
        }
        for (const name of this.names(step, "deleted_classes")) {
          live.delete(name);
          seen.add(name);
        }
        for (const rename of step.renamed_classes ?? []) {
          const backend = live.get(rename.from) ?? "unknown";
          live.delete(rename.from);
          seen.add(rename.from);
          live.set(rename.to, backend);
          seen.add(rename.to);
        }
        for (const transfer of step.transferred_classes ?? []) {
          live.set(transfer.to, "unknown");
          seen.add(transfer.to);
        }
      }
      const additions = hosts.filter((host) => {
        if (seen.has(host.exportName) && !live.has(host.exportName))
          throw new AlephaError(
            `Required Durable Object '${host.exportName}' has a lifecycle tombstone`,
          );
        return !live.has(host.exportName);
      });
      if (additions.length) {
        let n = 1;
        while (tags.has(`alepha-hosts-v${n}`)) n++;
        const step: Record<string, any> = { tag: `alepha-hosts-v${n}` };
        const sqlite = additions
          .filter((host) => host.backend === "sqlite")
          .map((host) => host.exportName);
        const kv = additions
          .filter((host) => host.backend === "kv")
          .map((host) => host.exportName);
        if (sqlite.length) step.new_sqlite_classes = sqlite;
        if (kv.length) step.new_classes = kv;
        history.push(step);
      }
      config.migrations = history;
    } else {
      for (const host of hosts) {
        const existing = exports[host.exportName];
        if (existing) {
          if (
            existing.type !== "durable-object" ||
            ![undefined, "created", "expecting-transfer"].includes(
              existing.state,
            ) ||
            !["sqlite", "legacy-kv"].includes(existing.storage)
          )
            throw new AlephaError(
              `Conflicting Durable Object export '${host.exportName}'`,
            );
        } else
          exports[host.exportName] = {
            type: "durable-object",
            storage: host.backend === "sqlite" ? "sqlite" : "legacy-kv",
          };
      }
      config.exports = exports;
    }
    config.durable_objects = { ...config.durable_objects, bindings };
  }
  protected names(step: Record<string, any>, field: string): string[] {
    const names = step[field] ?? [];
    if (
      !Array.isArray(names) ||
      !names.every((name) => typeof name === "string" && name.length > 0)
    )
      throw new AlephaError(
        `Invalid Durable Object migration field '${field}'`,
      );
    return names;
  }
  public async assertToolchain(
    root: string,
    config: Record<string, any>,
  ): Promise<void> {
    if (
      !Object.values(config.exports ?? {}).some(
        (item: any) => item.type === "durable-object",
      )
    )
      return;
    let current = this.fs.resolve(root);
    for (;;) {
      const path = this.fs.join(
        current,
        "node_modules/wrangler/config-schema.json",
      );
      if (await this.fs.exists(path)) {
        const schema = JSON.parse(
          (await this.fs.readFile(path)).toString("utf8"),
        );
        if (
          !(
            schema.properties?.exports ??
            schema.definitions?.RawConfig?.properties?.exports
          )
        )
          throw new AlephaError(
            "Installed Wrangler does not support declarative Durable Object exports. Upgrade Wrangler or configure explicit legacy migrations.",
          );
        return;
      }
      const parent = this.fs.resolve(current, "..");
      if (parent === current) return;
      current = parent;
    }
  }
}
