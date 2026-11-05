import { Alepha } from "alepha";
import { AlephaReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

import { $uiSwagger } from "../$uiSwagger.tsx";

describe("$uiSwagger", () => {
  it("mounts the explorer at /docs, reading /docs/json, by default", ({
    expect,
  }) => {
    class App {
      docs = $uiSwagger();
    }
    const app = Alepha.create().with(AlephaReactRouter).inject(App);
    expect(app.docs.options.name).toBe("swagger");
    expect(app.docs.options.path).toBe("/docs");
    expect(app.docs.options.props?.()).toEqual({ specUrl: "/docs/json" });
    expect(app.docs.options.head).toEqual({ title: "API" });
    expect(typeof app.docs.options.lazy).toBe("function");
  });

  it("takes a path, a document URL, a title and a name", ({ expect }) => {
    class App {
      docs = $uiSwagger({
        name: "apiDocs",
        path: "/developers/api",
        spec: "https://api.example.com/openapi.json",
        title: "Example API",
      });
    }
    const app = Alepha.create().with(AlephaReactRouter).inject(App);
    expect(app.docs.options.name).toBe("apiDocs");
    expect(app.docs.options.path).toBe("/developers/api");
    expect(app.docs.options.props?.()).toEqual({
      specUrl: "https://api.example.com/openapi.json",
    });
    expect(app.docs.options.head).toEqual({ title: "Example API" });
  });

  it("lazy-loads the explorer component", async ({ expect }) => {
    class App {
      docs = $uiSwagger();
    }
    const app = Alepha.create().with(AlephaReactRouter).inject(App);
    const chunk = await app.docs.options.lazy!();
    expect(typeof chunk.default).toBe("function");
  });
});
