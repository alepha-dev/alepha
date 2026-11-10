import {
  $atom,
  $inject,
  $module,
  Alepha,
  TooLateSubstitutionError,
  z,
} from "alepha";
import type { FC } from "react";
import { describe, it } from "vitest";

import { $page, NestedView } from "../index.ts";

/**
 * The guide "Extending a module", run: a packaged module (a router, a
 * service, an option, a component slot) and what a downstream app may change
 * in it without forking it. Every claim the guide makes is a case here.
 */
describe("extending a packaged module", () => {
  // ---- the package ------------------------------------------------------------------------------------------------

  const crmOptions = $atom({
    name: "crm.options",
    schema: z.object({ pageSize: z.integer() }),
    default: { pageSize: 25 },
  });

  class PricingService {
    quote(amount: number): string {
      return `${amount} EUR`;
    }
  }

  /**
   * The components the package lets an app replace, one field each.
   */
  class CrmSlots {
    ClientBadge: FC<{ name: string }> = (props) => <b>{props.name}</b>;
  }

  class CrmRouter {
    protected readonly alepha = $inject(Alepha);
    protected readonly pricing = $inject(PricingService);
    protected readonly slots = $inject(CrmSlots);

    clients = $page({
      path: "/clients",
      component: () =>
        `Clients, ${this.alepha.store.get(crmOptions).pageSize} per page`,
    });

    client = $page({
      path: "/clients/:id",
      component: () => {
        const { ClientBadge } = this.slots;
        return (
          <>
            <ClientBadge name="Ada" /> owes {this.pricing.quote(100)}
            <NestedView />
          </>
        );
      },
    });
  }

  const CrmModule = $module({
    name: "crm",
    services: [CrmRouter, PricingService, CrmSlots],
    atoms: [crmOptions],
  });

  // ---- the app ----------------------------------------------------------------------------------------------------

  /**
   * What a reader sees of rendered HTML: no tag, no React marker, no entity.
   * `mark` says whether the app's own badge was drawn.
   */
  const seen = (html: string) => ({
    text: html
      .replace(/<!--.*?-->/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&#x27;/g, "'"),
    badge: /<mark\b/.test(html) ? "mark" : /<b\b/.test(html) ? "b" : "none",
  });

  it("renders the package as shipped", async ({ expect }) => {
    const alepha = Alepha.create().with(CrmModule);
    const crm = alepha.inject(CrmRouter);
    await alepha.start();

    expect(seen((await crm.clients.render()).html).text).toBe(
      "Clients, 25 per page",
    );
    const client = seen(
      (await crm.client.render({ params: { id: "1" } })).html,
    );
    expect(client.text).toBe("Ada owes 100 EUR");
    expect(client.badge).toBe("b");
  });

  it("replaces one page with override(), on the instance", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(CrmModule);
    const crm = alepha.inject(CrmRouter);
    crm.clients.override({ component: () => "Acme's own client list" });
    await alepha.start();

    expect(seen((await crm.clients.render()).html).text).toBe(
      "Acme's own client list",
    );
    // The path, and every other option, is the package's still.
    expect(crm.clients.options.path).toBe("/clients");
  });

  it("replaces one page with override(), in a subclass", async ({ expect }) => {
    class AcmeCrmRouter extends CrmRouter {
      constructor() {
        super();
        this.clients.override({ component: () => "Acme's own client list" });
      }
    }
    // Before the module: the first substitution recorded is the one used.
    const alepha = Alepha.create()
      .with({ provide: CrmRouter, use: AcmeCrmRouter })
      .with(CrmModule);
    const crm = alepha.inject(CrmRouter);
    await alepha.start();

    expect(crm).toBeInstanceOf(AcmeCrmRouter);
    expect(seen((await crm.clients.render()).html).text).toBe(
      "Acme's own client list",
    );
  });

  it("refuses override() once the app has started", async ({ expect }) => {
    const alepha = Alepha.create().with(CrmModule);
    const crm = alepha.inject(CrmRouter);
    await alepha.start();

    expect(() => crm.clients.override({ component: () => "late" })).toThrow(
      "Cannot override primitive 'clients' after Alepha has started",
    );
  });

  it("adds a page of its own under a page of the package", async ({
    expect,
  }) => {
    class AcmeRouter {
      protected readonly crm = $inject(CrmRouter);

      contracts = $page({
        parent: this.crm.client,
        path: "/contracts",
        component: () => " and has 3 contracts",
      });
    }
    const alepha = Alepha.create().with(CrmModule);
    const acme = alepha.inject(AcmeRouter);
    await alepha.start();

    const { html, response } = await acme.contracts.fetch({
      params: { id: "1" },
    });
    expect(new URL(response.url).pathname).toBe("/clients/1/contracts");
    expect(seen(html).text).toBe("Ada owes 100 EUR and has 3 contracts");
  });

  it("adopts the package's pages under a layout of its own", async ({
    expect,
  }) => {
    class AcmeRouter {
      protected readonly crm = $inject(CrmRouter);

      shell = $page({
        path: "/acme",
        children: () => [this.crm.clients, this.crm.client],
        component: () => (
          <>
            Acme | <NestedView />
          </>
        ),
      });
    }
    const alepha = Alepha.create().with(CrmModule);
    alepha.inject(AcmeRouter);
    const crm = alepha.inject(CrmRouter);
    await alepha.start();

    const { html, response } = await crm.clients.fetch();
    expect(new URL(response.url).pathname).toBe("/acme/clients");
    expect(seen(html).text).toBe("Acme | Clients, 25 per page");
  });

  it("swaps one service, when the substitution comes before the module", async ({
    expect,
  }) => {
    class AcmePricingService extends PricingService {
      override quote(amount: number): string {
        return `${amount * 1.2} EUR incl. VAT`;
      }
    }
    const alepha = Alepha.create()
      .with({ provide: PricingService, use: AcmePricingService })
      .with(CrmModule);
    const crm = alepha.inject(CrmRouter);
    await alepha.start();

    expect(
      seen((await crm.client.render({ params: { id: "1" } })).html).text,
    ).toBe("Ada owes 120 EUR incl. VAT");
  });

  it("refuses a substitution that comes after the module built the service", ({
    expect,
  }) => {
    class AcmePricingService extends PricingService {}
    const alepha = Alepha.create().with(CrmModule);

    expect(() =>
      alepha.with({ provide: PricingService, use: AcmePricingService }),
    ).toThrow(TooLateSubstitutionError);
  });

  it("refuses a second substitution of one service, unless it is optional", ({
    expect,
  }) => {
    class First extends PricingService {
      override quote(): string {
        return "first";
      }
    }
    class Second extends PricingService {
      override quote(): string {
        return "second";
      }
    }
    const alepha = Alepha.create().with({
      provide: PricingService,
      use: First,
    });

    expect(() => alepha.with({ provide: PricingService, use: Second })).toThrow(
      TooLateSubstitutionError,
    );

    // `optional` keeps the one already recorded, silently: a package's own
    // default, declared this way, yields to the app's.
    alepha
      .with({ provide: PricingService, use: Second, optional: true })
      .with(CrmModule);
    expect(alepha.inject(PricingService).quote(1)).toBe("first");
  });

  it("replaces a nested option whole: override() is a shallow merge", ({
    expect,
  }) => {
    class App {
      page = $page({
        path: "/p/:id",
        schema: {
          params: z.object({ id: z.text() }),
          query: z.object({ tab: z.text().optional() }),
        },
        component: () => "p",
      });
    }
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    // The cast is the type system agreeing with the limit: the page's types
    // were inferred from the schema it declared.
    app.page.override({
      schema: { params: z.object({ id: z.text() }) } as never,
    });

    expect(app.page.options.schema?.params).toBeDefined();
    expect(app.page.options.schema?.query).toBeUndefined();
  });

  it("takes an option set before the module is registered too", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.set(crmOptions, { pageSize: 10 });
    alepha.with(CrmModule);
    const crm = alepha.inject(CrmRouter);
    await alepha.start();

    expect(seen((await crm.clients.render()).html).text).toBe(
      "Clients, 10 per page",
    );
  });

  it("changes one option through the module's atom", async ({ expect }) => {
    const alepha = Alepha.create().with(CrmModule);
    alepha.set(crmOptions, { pageSize: 50 });
    const crm = alepha.inject(CrmRouter);
    await alepha.start();

    expect(seen((await crm.clients.render()).html).text).toBe(
      "Clients, 50 per page",
    );
  });

  it("swaps one component inside a page, because the package exposes it as a service", async ({
    expect,
  }) => {
    class AcmeSlots extends CrmSlots {
      override ClientBadge: FC<{ name: string }> = (props) => (
        <mark>{props.name}</mark>
      );
    }
    const alepha = Alepha.create()
      .with({ provide: CrmSlots, use: AcmeSlots })
      .with(CrmModule);
    const crm = alepha.inject(CrmRouter);
    await alepha.start();

    const client = seen(
      (await crm.client.render({ params: { id: "1" } })).html,
    );
    expect(client.text).toBe("Ada owes 100 EUR");
    expect(client.badge).toBe("mark");
  });
});
