import { AlephaError } from "alepha";
import { describe, expect, it } from "vitest";

import { EmbeddedStaticFileSource } from "../index.ts";

describe("EmbeddedStaticFileSource", () => {
  /**
   * Vitest runs on Node, where `Bun` does not exist: the one place this source
   * is built wrongly on purpose. It must fail at boot with a reason, not on the
   * first request with `Bun is not defined`.
   */
  it("refuses to be built without the Bun runtime", () => {
    expect(
      () =>
        new EmbeddedStaticFileSource(
          { "/app.css": "/$bunfs/root/app.css" },
          1767323045000,
        ),
    ).toThrow(AlephaError);
    expect(
      () =>
        new EmbeddedStaticFileSource(
          { "/app.css": "/$bunfs/root/app.css" },
          1767323045000,
        ),
    ).toThrow(/Bun binary they were compiled into/);
  });
});
