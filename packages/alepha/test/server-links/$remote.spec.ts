import { Alepha, t } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import {
  $client,
  $remote,
  AlephaServerLinks,
  LinkProvider,
  ServerLinksProvider,
} from "../../src/server-links";

describe("$remote", () => {
  it("should enable remote action calls between services", async ({
    expect,
  }) => {
    class App {
      ping = $action({
        schema: {
          response: t.object({
            pong: t.boolean(),
          }),
        },
        handler: () => {
          return { pong: true };
        },
      });
    }

    const alepha1 = Alepha.create().with(AlephaServerLinks).with(App);

    // --

    class Config {
      alepha1 = $remote({
        url: () => alepha1.inject(ServerProvider).hostname,
      });
    }

    const alepha2 = Alepha.create({ env: {} })
      .with(AlephaServerLinks)
      .with(Config);

    // --

    await alepha1.start();
    await alepha2.start();

    const app = alepha2.inject(LinkProvider).client<App>();
    const ping = () => alepha2.context.run(() => app.ping());
    expect(await ping()).toStrictEqual({ pong: true });
  });

  it("should handle complex multi-service architecture with proxies", async ({
    expect,
  }) => {
    const env = {
      LOG_LEVEL: "warn" as const,
    };

    class ServiceC {
      print = $action({
        handler: () => "TADA!",
      });
    }

    const c = Alepha.create({ env }).with(ServiceC).with(ServerLinksProvider);

    class ServiceB {
      compute = $action({
        handler: () => {
          return "42";
        },
      });
    }

    const b = Alepha.create({ env }).with(ServiceB).with(ServerLinksProvider);

    class ServiceA {
      br = $remote({
        url: () => b.inject(ServerProvider).hostname,
      });

      cr = $remote({
        url: () => c.inject(ServerProvider).hostname,
        proxy: true,
      });

      sb = $client<ServiceB>();
      sc = $client<ServiceC>();

      getReport = $action({
        handler: async () => {
          const b = await this.sb.compute();
          const c = await this.sc.print();
          return `B: ${b}, C: ${c}`;
        },
      });
    }

    const a = Alepha.create({ env }).with(ServiceA).with(ServerLinksProvider);

    class WebApp {
      a = $remote({
        url: () => a.inject(ServerProvider).hostname,
        proxy: true,
      });

      ping = $action({
        handler: async () => {
          return "pong";
        },
      });
    }

    const front = Alepha.create({ env }).with(WebApp).with(ServerLinksProvider);

    await c.start();
    await b.start();
    await a.start();
    await front.start();

    const linkProvider = front.inject(LinkProvider);

    expect(await getLinks(c)).toEqual({
      links: [
        {
          group: "ServiceC",
          name: "print",
          path: "/print",
        },
      ],
      prefix: "/api",
    });

    expect(await getLinks(b)).toEqual({
      links: [
        {
          group: "ServiceB",
          name: "compute",
          path: "/compute",
        },
      ],
      prefix: "/api",
    });

    expect(await getLinks(a)).toEqual({
      links: [
        {
          group: "ServiceA",
          name: "getReport",
          path: "/getReport",
        },
        {
          group: "ServiceC",
          name: "print",
          path: "/print",
          service: "cr",
        },
      ],
      prefix: "/api",
    });

    expect(await getLinks(front)).toEqual({
      links: [
        {
          group: "WebApp",
          name: "ping",
          path: "/ping",
        },
        {
          group: "ServiceA",
          name: "getReport",
          path: "/getReport",
          service: "a",
        },
        {
          group: "ServiceC",
          name: "print",
          path: "/cr/print",
          service: "a",
        },
      ],
      prefix: "/api",
    });

    expect(await linkProvider.client<WebApp>().ping.run({})).toEqual("pong");
    expect(
      await linkProvider
        .client<WebApp>(front.inject(ServerProvider))
        .ping.fetch({})
        .then((it) => it.data),
    ).toEqual("pong");

    expect(await linkProvider.client<ServiceA>().getReport()).toEqual(
      "B: 42, C: TADA!",
    );
    expect(
      await linkProvider
        .client<ServiceA>()
        .getReport.fetch({})
        .then((it) => it.data),
    ).toEqual("B: 42, C: TADA!");

    expect(await linkProvider.client<ServiceC>().print()).toEqual("TADA!");
    expect(
      await linkProvider
        .client<ServiceC>()
        .print.fetch({})
        .then((it) => it.data),
    ).toEqual("TADA!");

    await expect(() =>
      linkProvider.client<ServiceB>().compute(),
    ).rejects.toThrow("Action compute not found");
  });
});

const getLinks = (a: Alepha) =>
  fetch(`${a.inject(ServerProvider).hostname}/api/_links`).then((res) =>
    res.json(),
  );
