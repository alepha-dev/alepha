import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";
import type { UploadsApi } from "../api/UploadsApi.ts";
import type { VisitsApi } from "../api/VisitsApi.ts";

export class AppRouter {
  protected readonly visitsApi = $client<VisitsApi>();
  protected readonly uploadsApi = $client<UploadsApi>();

  home = $page({
    head: { title: "example-bay-app" },
    lazy: () => import("./Home.tsx"),
    loader: async () => ({
      // Both come from state Bay had to provision: the counter from the SQLite
      // file it created, the file list from the storage directory it made
      // writable. A redeploy must leave both intact.
      count: await this.visitsApi.visit().then((r) => r.count),
      files: await this.uploadsApi.list(),
    }),
  });
}
