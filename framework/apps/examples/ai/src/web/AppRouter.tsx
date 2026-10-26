import { $page } from "alepha/react/router";

import { Layout } from "./Layout.tsx";

/**
 * The routes: a layout and the notes page.
 */
export class AppRouter {
  layout = $page({
    component: Layout,
    children: (): any[] => [this.notes],
  });

  notes = $page({
    name: "notes",
    path: "/",
    head: { title: "Notes with an assistant · Alepha example" },
    lazy: () => import("./pages/Notes.tsx"),
  });
}
