import { $page } from "alepha/react/router";
import { $secure } from "alepha/security";
import { $client } from "alepha/server/links";

import type { HelloController } from "../api/controllers/HelloController.ts";
import type { NoteController } from "../api/controllers/NoteController.ts";
import { Layout } from "./components/Layout.tsx";

/**
 * The test app's own pages, under one layout.
 *
 * `/` is unprotected and its loader calls the API, so a shell can boot and
 * fetch across origins without a session. `/notes` is protected: its loader
 * lists the signed-in user's notes, and the page writes and deletes them
 * (the delete asks for confirmation first).
 */
export class AppRouter {
  protected readonly helloApi = $client<HelloController>();
  protected readonly noteApi = $client<NoteController>();

  layout = $page({
    component: Layout,
    children: () => [this.home, this.notes],
  });

  home = $page({
    path: "/",
    lazy: () => import("./pages/Home.tsx"),
    loader: () => this.helloApi.hello(),
  });

  notes = $page({
    path: "/notes",
    use: [$secure()],
    lazy: () => import("./pages/Notes.tsx"),
    loader: async () => ({ notes: await this.noteApi.listNotes() }),
  });
}
