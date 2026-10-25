import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

/**
 * Exposes the protected formatter so the frozen-clock branch can be exercised
 * directly — the condition it guards cannot be produced under Node, where
 * `performance.now()` always advances.
 */
class TestAlepha extends Alepha {
  public testReadyMessage = this.readyMessage.bind(this);
}

describe("Alepha#readyMessage", () => {
  const alepha = new TestAlepha();

  it("should report the duration when the clock advanced", () => {
    expect(alepha.testReadyMessage(42.4)).toBe("App is now ready [42ms]");
    expect(alepha.testReadyMessage(1234.6)).toBe("App is now ready [1235ms]");
  });

  /**
   * A sub-millisecond boot is still a real measurement — it rounds to 0 but the
   * clock did move, so the bracket stays.
   */
  it("should keep the bracket for a genuinely sub-millisecond boot", () => {
    expect(alepha.testReadyMessage(0.4)).toBe("App is now ready [0ms]");
  });

  /**
   * On workerd `performance.now()` does not advance during pure-CPU work — it
   * only moves after I/O, and container boot performs none. An exactly-zero
   * delta therefore means "the runtime could not measure this", not "the boot
   * was free". Measured on lore-production: 12/12 cold starts emitted every
   * boot log line under one identical timestamp while burning 30-216ms of CPU,
   * and every one of them printed "[0ms]".
   *
   * Claiming 0ms there is worse than saying nothing, so the bracket is dropped.
   */
  it("should omit the duration when the clock never moved", () => {
    expect(alepha.testReadyMessage(0)).toBe("App is now ready");
  });

  it("should omit the duration for a negative delta", () => {
    expect(alepha.testReadyMessage(-1)).toBe("App is now ready");
  });
});
