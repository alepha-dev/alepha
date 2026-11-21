import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { ReactPageProvider } from "../providers/ReactPageProvider.ts";

/**
 * The path compiler: what `router.push(name, { params })` and `<Link>` put
 * in the address bar.
 */
describe("ReactPageProvider.compile", () => {
  const compile = () => {
    const pages = Alepha.create().inject(ReactPageProvider);
    return pages.compile.bind(pages);
  };

  it("should percent-encode a param value", ({ expect }) => {
    // The server decodes path params now, so a raw value here does not just
    // produce an ugly URL: it round-trips to something different.
    expect(compile()("/users/:id", { id: "John Doe" })).toBe(
      "/users/John%20Doe",
    );
    expect(compile()("/files/:name", { name: "a/b" })).toBe("/files/a%2Fb");
  });

  it("should treat `$&` in a value as literal text", ({ expect }) => {
    expect(compile()("/search/:q", { q: "$&" })).toBe("/search/%24%26");
  });

  it("should not let `:id` consume the prefix of `:idType`", ({ expect }) => {
    expect(compile()("/a/:idType/:id", { id: "1", idType: "sku" })).toBe(
      "/a/sku/1",
    );
  });

  it("should leave a token it has no value for untouched", ({ expect }) => {
    expect(compile()("/a/:known/:unknown", { known: "x" })).toBe(
      "/a/x/:unknown",
    );
  });
});
