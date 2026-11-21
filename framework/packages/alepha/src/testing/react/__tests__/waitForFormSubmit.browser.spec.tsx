import { Alepha, AlephaError } from "alepha";
import { AlephaReactForm } from "alepha/react/form";
import { describe, expect, it } from "vitest";

import { waitForFormSubmit } from "../form.ts";

describe("waitForFormSubmit", () => {
  const boot = () => Alepha.create().with(AlephaReactForm);

  it("resolves when the awaited form ends, whatever other forms end first", async () => {
    const alepha = boot();
    let settled = false;
    const waiting = (async () => {
      await waitForFormSubmit(alepha, "mine", 1000);
      settled = true;
    })();

    // Another form ending first must not consume the listener.
    await alepha.events.emit("form:submit:end", { id: "other" });
    await Promise.resolve();
    expect(settled).toBe(false);

    await alepha.events.emit("form:submit:end", { id: "mine" });
    await waiting;
    expect(settled).toBe(true);
  });

  it("rejects with an AlephaError on timeout", async () => {
    const alepha = boot();

    await expect(waitForFormSubmit(alepha, "never", 20)).rejects.toThrow(
      AlephaError,
    );
  });
});
