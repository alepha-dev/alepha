import { $page } from "alepha/react/router";

import { USERS } from "./users.ts";

/**
 * One server-rendered page, the cost the bench measures.
 */
export class RowsRouter {
  rows = $page({
    path: "/",
    head: { title: "Users" },
    // Rendered on every request: a cached page would measure the cache.
    cache: false,
    loader: () => ({ rows: USERS }),
    lazy: () => import("./UserTable.ts"),
  });
}
