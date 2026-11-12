import { $module, Alepha, type AppSurface } from "alepha";
import { describe, it } from "vitest";

import { $action, ServerProvider } from "../index.ts";

/**
 * A controller's `$action` registers the server module when the class is
 * constructed. An app whose only controller is pure and declared registers
 * no server at all, and nothing would ever create the controller: it is
 * created at boot instead (#Q3405).
 */
class HelloApi {
  hello = $action({ method: "GET", path: "/hello", handler: () => "hi" });
}

const surface: AppSurface = {
  version: 1,
  classes: [{ key: "app.api:HelloApi", pure: true }],
  actions: [
    {
      name: "hello",
      group: "HelloApi",
      method: "GET",
      path: "/hello",
      class: "app.api:HelloApi",
    },
  ],
  routes: [],
  pages: [],
  jobs: [],
  tools: [],
  resources: [],
  prompts: [],
};

describe("a declared controller no server would serve", () => {
  it("is created at boot, and its action answers", async ({ expect }) => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } }).useSurface(
      surface,
    );
    alepha.with($module({ name: "app.api", services: [HelloApi] }));
    await alepha.start();
    const host = alepha.inject(ServerProvider).hostname;
    expect(await (await fetch(`${host}/api/hello`)).text()).toBe("hi");
    await alepha.stop();
  });
});
