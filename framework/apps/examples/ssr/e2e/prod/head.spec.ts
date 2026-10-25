import { expect, request, test } from "@playwright/test";

/**
 * HEAD against a real production build (quest #1646).
 *
 * The unit specs in `packages/alepha` cover the fallback on a `$route` and on
 * a static asset. What only a built app can answer is the SSR document, whose
 * body is a `renderToReadableStream` rather than a string: HEAD has to cancel
 * that stream rather than drain it, and the whole point of the finding was
 * that it was reproduced against a production build and not in dev.
 *
 * The reason this matters is prosaic. A HEAD-based uptime monitor or load
 * balancer health check - a very common default - read an Alepha app as
 * permanently down, because every GET route answered HEAD with 404.
 *
 * Uses the `request` fixture rather than `page`: a browser will not issue a
 * bare HEAD, and `page.goto` cannot express one.
 */
test.describe("HEAD matches GET", () => {
  const paths = ["/health", "/healthz", "/"];

  for (const path of paths) {
    test(`answers ${path} with GET's status and no body`, async ({
      baseURL,
    }) => {
      const api = await request.newContext({ baseURL });

      const get = await api.get(path);
      const head = await api.head(path);

      expect(get.status()).toBe(200);
      expect(head.status()).toBe(get.status());
      expect(await head.body()).toHaveLength(0);
      expect(head.headers()["content-type"]).toBe(
        get.headers()["content-type"],
      );

      await api.dispose();
    });
  }

  test("answers a hashed asset the same way", async ({ baseURL }) => {
    const api = await request.newContext({ baseURL });

    // The document names its own entry bundle, so the hash never has to be
    // guessed or read off disk.
    const html = await (await api.get("/")).text();
    const asset = /src="(\/[^"]+\.js)"/.exec(html)?.[1];
    expect(asset, "no script src found in the SSR document").toBeTruthy();

    const get = await api.get(asset as string);
    const head = await api.head(asset as string);

    expect(get.status()).toBe(200);
    expect(head.status()).toBe(200);
    expect(await head.body()).toHaveLength(0);

    await api.dispose();
  });

  test("still 404s a path that answers nothing", async ({ baseURL }) => {
    const api = await request.newContext({ baseURL });
    const head = await api.head("/definitely-not-a-route-here");
    // Whatever a miss answers, HEAD has to answer the same: the fallback is
    // for routes that exist under GET, not a way to make everything 200.
    expect(head.status()).toBe(
      (await api.get("/definitely-not-a-route-here")).status(),
    );
    await api.dispose();
  });
});
