import { Alepha, AlephaError, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $page } from "../index.ts";
import { ReactRouter } from "../services/ReactRouter.ts";

/**
 * `push` and `anchor` take a page name, with that page's params, or a path
 * starting with "/" (#Q2679). Both are checked by the compiler on a typed
 * router and at runtime on any router.
 */
class AppRouter {
  home = $page({ path: "/", component: () => "home" });
  userProfile = $page({
    path: "/users/:id",
    schema: { params: z.object({ id: z.text() }) },
    component: () => "user",
  });
}

const boot = async () => {
  const alepha = Alepha.create();
  alepha.inject(AppRouter);
  await alepha.start();
  return alepha.inject(ReactRouter<AppRouter>);
};

describe("router.push forms, at the type level", () => {
  it("accepts a page name with its params, or a path", () => {
    // Never called: the compiler reads these, the test only has to exist.
    const check = (router: ReactRouter<AppRouter>) => {
      void router.push("home");
      void router.push("userProfile", { params: { id: "1" } });
      void router.push("/users/1", { query: { tab: "a" }, replace: true });

      // @ts-expect-error a misspelled page name
      void router.push("userProfle");
      // @ts-expect-error params are required by the page's schema
      void router.push("userProfile");
      // @ts-expect-error a param of the wrong name
      void router.push("userProfile", { params: { userId: "1" } });
      // @ts-expect-error a relative path
      void router.push("users/1");
      // @ts-expect-error an absolute URL is not router navigation
      void router.push("https://example.com/");
      // @ts-expect-error params belong to a page name, not to a path
      void router.push("/users/1", { params: { id: "1" } });

      router.anchor("userProfile", { params: { id: "1" } });
      // @ts-expect-error anchor follows the same forms
      router.anchor("nowhere");
    };
    expect(check).toBeTypeOf("function");
  });
});

describe("router.push forms, at runtime", () => {
  it("refuses an unknown page name and names the closest", async () => {
    const router = await boot();

    await expect(router.push("userProfle" as never)).rejects.toThrow(
      AlephaError,
    );
    await expect(router.push("userProfle" as never)).rejects.toThrow(
      /'userProfile'/,
    );
    expect(() => router.anchor("relative/path" as never)).toThrow(
      /No page is named 'relative\/path'/,
    );
  });

  it("resolves a page name with its params, and a path with its query", async () => {
    const router = await boot();

    expect(router.anchor("userProfile", { params: { id: "42" } }).href).toBe(
      "/users/42",
    );
    expect(router.anchor("/users/42", { query: { tab: "keys" } }).href).toBe(
      "/users/42?tab=keys",
    );
  });
});
