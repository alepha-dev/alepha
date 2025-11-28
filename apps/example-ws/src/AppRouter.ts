import { $page } from "@alepha/react";
import { Chat } from "./Chat.tsx";

export class AppRouter {
  home = $page({
    path: "/",
    component: Chat,
  });
}
