import assert from "node:assert/strict";

export interface ActorContractFixture {
  call(
    name: string,
    method?: string,
    args?: unknown[],
    key?: string,
    other?: boolean,
  ): Promise<any>;
  local(value?: number): Promise<number>;
  put(raw: string): Promise<void>;
  raw(): Promise<string | undefined>;
}

/**
 * One set of observable semantics, driven by every real execution backend.
 */
export class ActorContract {
  public static async run(fixture: ActorContractFixture): Promise<void> {
    const counter = (
      method?: string,
      args?: unknown[],
      key?: string,
      other?: boolean,
    ) => fixture.call("contract.counter", method, args, key, other);
    assert.deepEqual(
      await Promise.all(Array.from({ length: 8 }, () => counter())),
      Array(8).fill(0),
    );
    await fixture.local(100);
    assert.equal(await counter(), 0);
    const values = await Promise.all(
      Array.from({ length: 40 }, () => counter("add")),
    );
    assert.deepEqual(
      values.sort((a, b) => a - b),
      Array.from({ length: 40 }, (_, i) => i + 1),
    );
    assert.equal(await counter(), 40);
    assert.equal(await fixture.local(), 100);
    assert.equal(await counter(undefined, undefined, undefined, true), 0);
    assert.equal(await counter("add", [3], "default"), 3);
    assert.equal(await counter(), 40);
    assert.equal(await counter(undefined, undefined, "default"), 3);
    assert.equal(await fixture.call("contract:actor:b", "add", [7], "c"), 7);
    assert.equal(
      await fixture.call("contract:actor", undefined, undefined, "b:c"),
      0,
    );
    assert.equal(
      await fixture.call("actor:b", undefined, undefined, "c", true),
      0,
    );
    const input = { name: "kept" };
    const pending = fixture.call("contract.session", "append", [input]);
    input.name = "changed";
    const snapshot = await pending;
    assert.deepEqual(snapshot, { names: ["kept"], nested: { count: 1 } });
    snapshot.names.push("caller mutation");
    snapshot.nested.count = 999;
    assert.deepEqual(await fixture.call("contract.session"), {
      names: ["kept"],
      nested: { count: 1 },
    });
    for (const method of ["fail", "invalid", "promise"])
      await assert.rejects(() => counter(method));
    await assert.rejects(() => counter("add", [undefined]));
    for (const method of ["mutate", "undefinedResult"])
      await assert.rejects(() => fixture.call("contract.session", method));
    assert.equal(await counter(), 40);
    assert.deepEqual(await fixture.call("contract.session"), {
      names: ["kept"],
      nested: { count: 1 },
    });
    assert.equal(await counter("add"), 41);
    assert.equal(await fixture.call("contract.corrupt", "add"), 1);
    for (const raw of [
      "{",
      '{"version":2,"revision":0,"state":0}',
      '{"version":1,"revision":0,"state":0.5}',
      '{"version":1,"revision":9007199254740991,"state":0}',
    ]) {
      await fixture.put(raw);
      await assert.rejects(() => fixture.call("contract.corrupt", "add"));
      assert.equal(await fixture.raw(), raw);
    }
  }
}
