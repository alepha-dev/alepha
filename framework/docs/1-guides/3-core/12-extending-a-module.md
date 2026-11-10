# Extending a Module

A module you installed is not a sealed box. An app can replace one of its
pages, add pages around it, swap one of its services and change its options,
all from its own code, without forking the package or asking it for a hook.
This is what lets one product ship as a package and several customer apps
each carry their own differences.

Three mechanisms do it, plus the module's own options:

| You want to                                         | Use                                     | Where             |
| --------------------------------------------------- | --------------------------------------- | ----------------- |
| Replace a page's component, or any primitive option | `primitive.override({ ... })`           | before `start()`  |
| Add a page of yours under a page of the package     | `parent: this.router.page` on your page | your router       |
| Put the package's pages under a layout of yours     | `children: () => [...]` on your layout  | your router       |
| Replace a service's behaviour                       | `alepha.with({ provide, use })`         | before the module |
| Change a setting the package exposes                | `alepha.set(atom, value)` on its atom   | before `start()`  |
| Replace one component inside a page                 | a slots service, swapped like a service | before the module |

The rest of this page is one example: a package, then an app that changes it
in each of those ways.

## The package

`@acme/crm` exports a router, a service, an options atom, and the module that
groups them:

```tsx
import { $atom, $inject, $module, Alepha, z } from "alepha";
import { $page, NestedView } from "alepha/react/router";
import type { FC } from "react";

export const crmOptions = $atom({
  name: "crm.options",
  schema: z.object({ pageSize: z.integer() }),
  default: { pageSize: 25 },
});

export class PricingService {
  quote(amount: number): string {
    return `${amount} EUR`;
  }
}

// The components the package lets an app replace, one field each.
export class CrmSlots {
  ClientBadge: FC<{ name: string }> = (props) => <b>{props.name}</b>;
}

export class CrmRouter {
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

export const CrmModule = $module({
  name: "crm",
  services: [CrmRouter, PricingService, CrmSlots],
  atoms: [crmOptions],
});
```

Nothing here was written for extension except `CrmSlots` and the
`<NestedView />` in `client`. Everything else is an ordinary module.

## Replace a page

Every primitive has `override()`: it shallow-merges new options into the ones
the package declared. On a `$page` that means its `component`, its `lazy`
import, its `loader`, its `head`: anything `$page` takes.

```tsx
const alepha = Alepha.create().with(CrmModule);

alepha.inject(CrmRouter).clients.override({
  component: () => <AcmeClients />,
});
```

`/clients` now renders `AcmeClients`. The path, the name and every option you
did not pass stay the package's, so links to the page keep working.

The same thing as a class, when you would rather keep the changes to one
router in one place:

```tsx
class AcmeCrmRouter extends CrmRouter {
  constructor() {
    super();
    this.clients.override({ component: () => <AcmeClients /> });
  }
}

const alepha = Alepha.create()
  .with({ provide: CrmRouter, use: AcmeCrmRouter })
  .with(CrmModule);
```

`override()` works on any primitive, not only pages: an `$action`'s options, a
`$job`'s schedule, a `$hook`'s event.

## Add a page under one of the package's

Your page names the package's page as its `parent`. It takes the parent's
path as a prefix and renders where the parent puts its `<NestedView />`:

```tsx
class AcmeRouter {
  protected readonly crm = $inject(CrmRouter);

  contracts = $page({
    parent: this.crm.client,
    path: "/contracts",
    component: () => <ClientContracts />,
  });
}
```

`/clients/1/contracts` renders the package's client page with
`ClientContracts` inside it.

## Put the package's pages under your layout

The other direction: your layout adopts pages it does not own, with
`children`. See [Nested Routing](/docs/guides-frontend-routing#nested-routing).

```tsx
class AcmeRouter {
  protected readonly crm = $inject(CrmRouter);

  shell = $page({
    path: "/acme",
    children: () => [this.crm.clients, this.crm.client],
    component: () => (
      <AcmeShell>
        <NestedView />
      </AcmeShell>
    ),
  });
}
```

The package's pages now live at `/acme/clients` and `/acme/clients/:id`,
inside `AcmeShell`.

## Swap a service

Substitute the class, and everything in the package that injects
`PricingService` gets yours instead. See
[Swapping Implementations](/docs/guides-core-alepha-instance#swapping-implementations).

```typescript
class AcmePricingService extends PricingService {
  override quote(amount: number): string {
    return `${amount * 1.2} EUR incl. VAT`;
  }
}

const alepha = Alepha.create()
  .with({ provide: PricingService, use: AcmePricingService })
  .with(CrmModule);
```

Extend the original and override what differs, so the methods you leave
alone, and the ones a later version of the package adds, keep working.

## Change an option

A package that exposes its settings as an atom lets you set them without
touching a class, any time before `start()`:

```typescript
const alepha = Alepha.create().with(CrmModule);

alepha.set(crmOptions, { pageSize: 50 });
```

A setting read from the environment is changed there instead: see
[Configurations](/docs/guides-core-configurations).

## Replace one component inside a page

`override()` replaces a page's whole component. It cannot reach inside it and
change one button: a component is a function, with nothing to merge into.

A package that wants a part of a page to be replaceable says so, by reading
that part from a service. That is `CrmSlots` above: the page renders
`this.slots.ClientBadge`, so the app swaps the service:

```tsx
class AcmeSlots extends CrmSlots {
  override ClientBadge: FC<{ name: string }> = (props) => (
    <mark>{props.name}</mark>
  );
}

const alepha = Alepha.create()
  .with({ provide: CrmSlots, use: AcmeSlots })
  .with(CrmModule);
```

If the package offers no such service, the options are to replace the whole
page with `override()`, or to ask the package for a slot.

## Limits

- **`override()` is for before `start()`.** Options are consumed while the app
  starts (routes are registered, jobs scheduled), so after that it throws
  `Cannot override primitive '...' after Alepha has started`. Call it right
  after registering the module, or in a subclass constructor.
- **`override()` is a shallow merge.** A nested option, such as a `$page`'s
  `schema`, is replaced whole, not merged field by field.
- **A substitution comes before the module.** `alepha.with({ provide, use })`
  must be recorded before anything builds the original; registering the module
  builds its services, so a substitution placed after `with(CrmModule)` throws
  `TooLateSubstitutionError`. So does a second substitution of the same
  service, unless it says `optional: true`, which keeps the first one: that is
  how a package declares a default the app may replace.
- **A subclass sees `protected` members, not `private` ones.** A package meant
  to be extended declares its members `protected`.
- **Inner components need a slot.** See above: only what the package reads
  from a service, an atom or an option can be changed from outside.
- **You are overriding a version.** An option you replace no longer follows
  the package: when it changes that page's loader or props in a later release,
  your component is the one to update.
