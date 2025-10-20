import { Alepha } from "@alepha/core";
import { describe, expect, it } from "vitest";
import { $retry } from "../src";

describe("$retry", () => {
  it("should retry handler up to max retries", async () => {
    class Dummy {
      inc = 0;
      workRetry = $retry({
        max: 3,
        handler: (n: number, end: number) => {
          this.inc += n;
          if (this.inc < end) {
            throw new Error("Retry");
          }
          return this.inc;
        },
      });

      work = async (n: number, end: number) => {
        this.inc = 0;
        return await this.workRetry(n, end);
      };
    }

    const app = Alepha.create();
    const basic = app.inject(Dummy);

    expect(await basic.work(1, 2)).toBe(2);
    expect(await basic.work(1, 3)).toBe(3);
    await expect(() => basic.work(1, 4)).rejects.toThrow(Error);
  });

  it("should only retry when condition matches", async () => {
    class Dummy {
      inc = 0;
      workRetry = $retry({
        max: 10,
        when: (err: Error) => err.message === "Retry1",
        handler: (n: number, end: number) => {
          this.inc += n;
          if (this.inc < end) {
            throw new Error(`Retry${this.inc}`);
          }
          return this.inc;
        },
      });

      async work(n: number, end: number) {
        this.inc = 0;
        return await this.workRetry(n, end);
      }
    }

    const app = Alepha.create();
    const basic = app.inject(Dummy);

    expect(await basic.work(1, 2)).toBe(2);
    await expect(() => basic.work(1, 3)).rejects.toThrow(Error);
  });
});
