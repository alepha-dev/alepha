/**
 * The two origins a Capacitor app's WebView calls an API from, in the
 * comma-separated form `corsOptions.origin` and `$cors({ origin })` take.
 *
 * - `capacitor://localhost`: iOS, Capacitor's custom scheme.
 * - `https://localhost`: Android, whose `androidScheme` has defaulted to
 *   `https` since Capacitor 6.
 *
 * Android's legacy `http://localhost` is deliberately left out: only an app
 * that set `androidScheme: "http"` itself uses it, and allowing it would let
 * any local plain-HTTP page call the API. Add it explicitly if you must.
 *
 * The matching is exact, so no LAN address is included: a development shell
 * served over the network (`alepha capacitor dev`) adds its own origin.
 *
 * Credentials stay off: a native app authenticates with a Bearer token, never
 * with a cookie, and `Authorization` is in the default allowed headers.
 * `AlephaServerCors` is not on by default; import it:
 *
 * ```ts
 * $module({
 *   name: "my.api",
 *   imports: [AlephaServerCors],
 *   register: (alepha) =>
 *     alepha.store.mut(corsOptions, (options) => ({
 *       ...options,
 *       origin: CAPACITOR_ORIGINS,
 *     })),
 * });
 * ```
 */
export const CAPACITOR_ORIGINS = "capacitor://localhost,https://localhost";
