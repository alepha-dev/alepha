import { $atom, z } from "alepha";

/**
 * Which sign-in page a denied part of the application belongs to.
 *
 * An anonymous visitor who reaches a guarded page is sent to the route named
 * `login`, by convention. Exactly one route can carry that name, so an
 * application serving two realms has no way to say that `/admin/reports`
 * belongs to one door and `/account` to another: every denial lands on
 * whichever page happens to hold the name. That was reported from an
 * application whose back office asks for an identifier, a password and a
 * realm, and whose public side asks for an email and a password - an expired
 * back-office session sent the agent to the citizen's door.
 *
 * Each entry maps a path PREFIX to a route name. The first entry whose prefix
 * the denied URL starts with wins, so the specific prefix goes first:
 *
 * ```ts
 * alepha.store.set(loginRoutesAtom, [
 *   { prefix: "/admin", route: "agent" },
 *   { prefix: "/", route: "signIn" },
 * ]);
 * ```
 *
 * ⚠️ **A prefix list rather than a resolver function**, so the value is data.
 * It validates against a schema, it serialises into the store, it is set the
 * same way on the server and in the browser, and it cannot close over a
 * router that exists on only one of them. A function would satisfy none of
 * those, and the question it answers - "which of my doors is this" - is one
 * an application knows statically.
 *
 * **Backwards compatible by construction.** Unset, or set to a list no prefix
 * of which matches, resolves `login` exactly as before, so a single-realm
 * application never sets this.
 *
 * ⚠️ Not to be confused with `@alepha/ui`'s `AdminRouterOptions.loginRouteName`,
 * which answers a narrower question on one surface: which route the admin
 * account menu's own Sign in button pushes. It is never read here, and it
 * cannot be - the framework does not import the UI kit, and the admin shell
 * knows nothing about the prefixes of the realms beside it. An application
 * with two doors sets both, to the same route name for the admin prefix.
 */
export const loginRoutesAtom = $atom({
  name: "alepha.react.router.loginRoutes",
  description: "Path prefix to sign-in route name, first match wins.",
  schema: z
    .array(
      z.object({
        /**
         * Matched with `String.startsWith` against the denied URL's pathname.
         * `/` matches everything and is the entry to put last.
         */
        prefix: z.string(),
        /**
         * The `$page` name to send the visitor to. A name no route carries
         * falls through to `login`, so a typo degrades to today's behaviour
         * rather than to a dead redirect.
         */
        route: z.string(),
      }),
    )
    .optional(),
});
