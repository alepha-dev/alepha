import { $hook, $inject, Alepha, type Atom, type State } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import type { Cookie } from "../primitives/$cookie.ts";
import { CookieParser } from "../services/CookieParser.ts";

/**
 * Browser variant of AtomCookiePersistence: reads `document.cookie` when a
 * `persist: "cookie"` atom registers, and writes it back on every mutation.
 *
 * Note: unlike the server variant, cookie names are not APP_NAME-prefixed —
 * same behavior as BrowserCookiePrimitive.
 */
export class AtomCookiePersistence {
  protected readonly alepha = $inject(Alepha);
  protected readonly cookieParser = $inject(CookieParser);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly atoms = new Map<string, Atom<any, any>>();

  protected readonly onRegister = $hook({
    on: "state:register",
    handler: ({ atom }) => {
      if (atom.options.persist !== "cookie") {
        return;
      }
      this.atoms.set(atom.key, atom);

      try {
        const raw = this.cookieParser.parseRequestCookies(document.cookie)[
          atom.key
        ];
        if (raw) {
          this.alepha.store.set(
            atom.key as keyof State,
            JSON.parse(decodeURIComponent(raw)),
            { skipEvents: true },
          );
        }
      } catch {
        // corrupted cookie — keep the default (or the hydrated value)
      }
    },
  });

  protected readonly onMutate = $hook({
    on: "state:mutate",
    handler: ({ key, value }) => {
      const atom = this.atoms.get(key as string);
      if (!atom) {
        return;
      }
      const cookie: Cookie = {
        value: encodeURIComponent(JSON.stringify(value)),
        path: "/",
        sameSite: "lax",
        maxAge: this.dateTime.duration([365, "days"]).as("seconds"),
      };
      // biome-ignore lint/suspicious/noDocumentCookie: cookie persistence adapter
      document.cookie = this.cookieParser.cookieToString(atom.key, cookie);
    },
  });
}
