import { $page } from "alepha/react/router";

import { Chat } from "./components/Chat.tsx";

export class AppRouter {
  home = $page({
    path: "/",
    component: Chat,
  });
}
