import { $inject, AbortedError, Alepha } from "alepha";
import {
  $page,
  AlephaReactRouter,
  ReactDomServerProvider,
  ReactPageCacheProvider,
} from "alepha/react/router";
import {
  NodeHttpServerProvider,
  type NodeRequestEvent,
  ServerProvider,
} from "alepha/server";
import { describe, it } from "vitest";

/**
 * SSR under the ambient signal (#E85): the visitor's render runs under the
 * request's signal, and the page cache's anonymous re-render, which serves
 * future visitors, never sees it.
 */
describe("SSR signal", () => {
  /**
   * Hands the test each request's disconnect controller, so it can play a
   * visitor leaving at an exact moment.
   */
  class TestServer extends NodeHttpServerProvider {
    public static controllers: AbortController[] = [];
    protected override createNodeRequestSignal(
      res: NodeRequestEvent["res"],
    ): AbortSignal {
      const signal = super.createNodeRequestSignal(res);
      const controller = new AbortController();
      signal.addEventListener("abort", () => controller.abort(signal.reason));
      TestServer.controllers.push(controller);
      return controller.signal;
    }
  }

  /**
   * Records the signal each render was given.
   */
  class TestDomServer extends ReactDomServerProvider {
    public static signals: Array<AbortSignal | undefined> = [];
    public override async load() {
      const module = await super.load();
      return {
        ...module,
        renderToReadableStream: (
          element: Parameters<typeof module.renderToReadableStream>[0],
          options?: Parameters<typeof module.renderToReadableStream>[1],
        ) => {
          TestDomServer.signals.push(options?.signal);
          return module.renderToReadableStream(element, options);
        },
      } as typeof module;
    }
  }

  const boot = async () => {
    TestServer.controllers = [];
    TestDomServer.signals = [];
    const loads: Array<{ signal: AbortSignal; anonymous: boolean }> = [];

    class App {
      alepha = $inject(Alepha);
      plain = $page({
        path: "/plain",
        loader: async () => {
          const anonymous = !!this.alepha.context.get(
            ReactPageCacheProvider.CHECK_KEY,
          );
          if (anonymous) {
            // The visitor leaves while the page is rendered again for the
            // cache: the re-render must not notice.
            for (const controller of TestServer.controllers) {
              controller.abort(new AbortedError("visitor gone"));
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          loads.push({ signal: this.alepha.context.signal, anonymous });
          return { n: 1 };
        },
        component: () => "plain",
      });
    }

    const alepha = Alepha.create()
      .with({ provide: ServerProvider, use: TestServer })
      .with({ provide: ReactDomServerProvider, use: TestDomServer })
      .with(AlephaReactRouter)
      .with(App);
    await alepha.start();
    const base = alepha.inject(ServerProvider).hostname;
    return { alepha, base, loads };
  };

  it("renders the visitor's page under the request's signal", async ({
    expect,
  }) => {
    const { base, loads } = await boot();

    const res = await fetch(`${base}/plain`);
    await res.text();

    const visitor = loads.find((it) => !it.anonymous);
    expect(visitor?.signal).toBe(TestServer.controllers[0].signal);
    expect(TestDomServer.signals[0]).toBe(TestServer.controllers[0].signal);
  });

  it("re-renders for the cache under the app signal, and completes after the visitor left", async ({
    expect,
  }) => {
    const { alepha, base, loads } = await boot();

    const res = await fetch(`${base}/plain`);
    await res.text();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const anonymous = loads.find((it) => it.anonymous);
    expect(anonymous?.signal).toBe(alepha.context.appSignal);
    expect(anonymous?.signal.aborted).toBe(false);
    expect(TestServer.controllers[0].signal.aborted).toBe(true);

    // The re-render finished, so the page went into the cache.
    const second = await fetch(`${base}/plain`);
    await second.text();
    expect(second.headers.get("x-alepha-cache")).toBe("hit; verdict=shared");
  });
});
