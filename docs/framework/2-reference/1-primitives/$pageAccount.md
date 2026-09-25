# $pageAccount

## Import

```typescript
import { $pageAccount } from "@alepha/ui/account";
```

## Overview

`$pageNav` already parented to `AccountRouter`'s `/account` shell:
the one-call form of "a page inside the shared account area".

It carries the `$` prefix to sit with the framework's other declarations at
a call site, but it is a plain function wrapping `$pageNav`, which wraps
`$page`. Nothing about its lifecycle differs from declaring `$page`
yourself.

The page appears in the sidebar with no separate registration: the layout
is `NavShell root="account"`, which walks the parent chain
and reads each page's own `nav`.

**Calling this registers `AccountRouter`.** Declaring even one page this
way mounts the whole `/account` shell including its five built-in pages:
an account page without the account area around it is not a thing. That is
the intended reading, but it is a real side effect: an application wanting
`/account` to carry only its own pages must build its own layout instead.

**Take an order between 100 and 999, in your own `nav.group`.** The
built-ins occupy `Account` (order 1) and `Security` (orders 1000-1003), and
`useNavEntries` sorts groups by their smallest member, so the application's
groups sit between the two: personal first, then the application, then
security. An order below 100 competes with Profile, one of 1000 or more
sinks the page in among the security pages.

**Frame the page with `AccountPage`**: `variant="table"` for a `DataTable`
that fills the area, `variant="form"` for a centred column of cards.

**Gate with `can: () => this.someApi.someAction.can()`, not `permission`
alone.** A permission named by this page's own `$secure` is self-declaring:
`$secure` registers it into `SecurityProvider` at definition time, so it
exists whether or not any controller backing the page does. An action name
resolves against `/api/_links`, which is built only from actions the server
actually registered.

```tsx
class OrganizationAccountRouter {
  protected readonly invitationApi =
    $client<OrganizationInvitationController>();

  invitations = $pageAccount({
    path: "/invitations",
    name: "accountInvitations",
    nav: {
      label: "Invitations",
      // ⚠️ `createElement(Mail)`, never `<Mail />`. This module graph is
      // imported by `alepha db migrations create` under `tsx` with the
      // classic JSX transform, where the element form emits a bare
      // `React.createElement` and breaks migration generation for the
      // whole app - far from the icon that caused it.
      icon: createElement(Mail),
      group: "Organizations",
      order: 100,
    },
    can: () => this.invitationApi.getMyOrganizationInvitations.can(),
    component: MyOrganizationInvitations,
  });
}
```
