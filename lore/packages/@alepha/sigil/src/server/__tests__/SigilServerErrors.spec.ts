import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { SigilForwardProvider } from "../SigilForwardProvider.ts";
import { SigilServerErrors } from "../SigilServerErrors.ts";

class FakeForward extends SigilForwardProvider {
  public ingested: any[] = [];
  enabled() {
    return true;
  }
  async forwardIngest(env: any) {
    this.ingested.push(env);
  }
}

describe("SigilServerErrors", () => {
  it("forwards server:onError as a server-origin blight", async () => {
    const alepha = Alepha.create({
      env: { NODE_ENV: "production", SERVER_PORT: 0 },
    }).with({
      provide: SigilForwardProvider,
      use: FakeForward,
    });
    alepha.inject(SigilServerErrors);
    await alepha.start();
    await alepha.events.emit("server:onError", {
      route: { path: "/x" },
      request: {},
      error: Object.assign(new Error("boom"), { name: "TypeError" }),
    } as any);
    const fwd = alepha.inject(SigilForwardProvider) as FakeForward;
    expect(fwd.ingested[0].errors[0].name).toBe("TypeError");
    expect(fwd.ingested[0].errors[0].origin).toBe("server");
    expect(fwd.ingested[0].errors[0].sourceUrl).toBe("/x");
  });

  it("does nothing when forward is disabled", async () => {
    class Disabled extends SigilForwardProvider {
      enabled() {
        return false;
      }
      public ingested: any[] = [];
      async forwardIngest(e: any) {
        this.ingested.push(e);
      }
    }
    const alepha = Alepha.create({
      env: { NODE_ENV: "production", SERVER_PORT: 0 },
    }).with({
      provide: SigilForwardProvider,
      use: Disabled,
    });
    alepha.inject(SigilServerErrors);
    await alepha.start();
    await alepha.events.emit("server:onError", {
      route: { path: "/x" },
      request: {},
      error: new Error("x"),
    } as any);
    expect((alepha.inject(SigilForwardProvider) as any).ingested).toHaveLength(
      0,
    );
  });
});
