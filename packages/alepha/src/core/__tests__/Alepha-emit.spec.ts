import { Alepha } from "alepha";
import { describe, it } from "vitest";

describe("alepha.events.emit", () => {
  it("should handle errors with catch option", async ({ expect }) => {
    const alepha = Alepha.create();

    alepha.events.on("test:echoed", () => {
      throw new Error("Error in echo");
    });

    await alepha.start();

    await expect(() => alepha.events.emit("test:echoed", {})).rejects.toThrow(
      "Error in echo",
    );

    expect(
      await alepha.events.emit("test:echoed", {}, { catch: true }),
    ).toEqual(undefined);
  });
});

declare module "alepha" {
  interface Hooks {
    "test:echoed": unknown;
  }
}
