import { $hook, $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import {
  requestBucketIndex,
  requestStatusClass,
} from "../shared/schemas/sigilRequestBuckets.ts";
import { SIGIL_INGEST_PATH } from "../shared/sigilPaths.ts";
import { SigilSinkProvider } from "./SigilSinkProvider.ts";

/**
 * Times every request the server answers, per route PATTERN (#Q3777), and
 * hands it to the sink folded into a histogram: what an API-latency
 * requirement is verified against.
 *
 * The route is the matched route's own path (`/api/users/:id`), never the
 * URL, so ids and query strings never leave the app and one route is one
 * series. The sigil's own beacon and ingest routes are left out: they are
 * the reporting, not the app.
 *
 * Timed from `server:request:before` to `server:response:after`, read
 * FIRST on the way out so the sink's own end-of-request flush on a
 * serverless runtime (also `server:response:after`) already carries it.
 */
export class SigilServerRequests {
  protected readonly sink = $inject(SigilSinkProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Where the start time rides on the request.
   */
  protected static readonly STARTED = "sigilRequestStartedAt";

  /**
   * Routes that are the sigil's own traffic: the same-origin beacon (an
   * `$action`, so under the API prefix) and a sink's ingest.
   */
  protected static readonly OWN_ROUTES = ["/sigil/ingest", SIGIL_INGEST_PATH];

  protected readonly onRequest = $hook({
    on: "server:request:before",
    priority: "first",
    handler: ({ request }) => {
      request.metadata[SigilServerRequests.STARTED] = this.dateTime.nowMillis();
    },
  });

  protected readonly onResponse = $hook({
    on: "server:response:after",
    priority: "first",
    handler: async ({ route, request, response }) => {
      const started = request.metadata[SigilServerRequests.STARTED];
      if (typeof started !== "number") return;
      const path = route?.path;
      if (
        !path ||
        SigilServerRequests.OWN_ROUTES.some((own) => path.endsWith(own))
      ) {
        return;
      }
      const duration = Math.max(0, this.dateTime.nowMillis() - started);
      await this.sink.ingest({
        requests: [
          {
            route: path.slice(0, 512),
            method: String(request.method ?? "GET")
              .toUpperCase()
              .slice(0, 16),
            status: requestStatusClass(response.status),
            bucket: requestBucketIndex(duration),
            count: 1,
          },
        ],
      });
    },
  });
}
