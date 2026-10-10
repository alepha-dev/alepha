import { Alepha } from "alepha";
import { MemoryActorProvider } from "alepha/actor";
import { describe, it } from "vitest";

import { ActorContract } from "./ActorContract.ts";
import { ContractActors } from "./ContractActors.ts";

class ContractMemoryProvider extends MemoryActorProvider {
  public put(raw: string): void {
    this.snapshots.set(this.codec.identity("", "contract.corrupt"), raw);
  }
  public raw(): string | undefined {
    return this.snapshots.get(this.codec.identity("", "contract.corrupt"));
  }
}

describe("Memory shared actor contract", () => {
  it("runs identical semantics with an independent second container", async ({
    expect,
  }) => {
    const primary = Alepha.create()
      .with({ provide: MemoryActorProvider, use: ContractMemoryProvider })
      .with(ContractActors);
    const other = Alepha.create({
      env: { ALEPHA_ACTOR_NAMESPACE: ":contract" },
    }).with(ContractActors);
    const storage = primary.inject(ContractMemoryProvider);
    await ActorContract.run({
      call: (name, method, args = [], key, separate) => {
        let actor = (separate ? other : primary)
          .inject(ContractActors)
          .byName(name);
        if (key !== undefined) actor = actor.get(key);
        return method === undefined ? actor.read() : actor[method](...args);
      },
      local: async (value) => {
        if (value !== undefined)
          primary.store.set(ContractActors.counterAtom, value);
        return primary.store.get(ContractActors.counterAtom);
      },
      put: async (raw) => storage.put(raw),
      raw: async () => storage.raw(),
    });
    primary.loadEnv({ ALEPHA_ACTOR_NAMESPACE: ":contract" });
    const fresh = await primary
      .inject(ContractActors)
      .namespaceCollision.get("c")
      .read();
    expect(fresh).toBe(0);
  });
});
