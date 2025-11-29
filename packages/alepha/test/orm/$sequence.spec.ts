import { Alepha } from "alepha";
import { $sequence } from "alepha/orm";
import { describe, expect, it } from "vitest";

describe("$sequence", () => {
  class App {
    seq = $sequence();
    seq2 = $sequence({ startWith: 100, increment: 2 });
  }

  const alepha = Alepha.create();
  const app = alepha.inject(App);

  it("should generate sequential numbers", async () => {
    expect(await app.seq.next()).toBe(1);
    expect(await app.seq.next()).toBe(2);
    expect(await app.seq.next()).toBe(3);
    expect(await app.seq.current()).toBe(3);
    expect(await app.seq.next()).toBe(4);
  });

  it("should support custom start and increment options", async () => {
    expect(await app.seq2.next()).toBe(100);
    expect(await app.seq2.next()).toBe(102);
    expect(await app.seq2.next()).toBe(104);
    expect(await app.seq2.current()).toBe(104);
    expect(await app.seq2.next()).toBe(106);
  });
});
