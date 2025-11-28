import { $page } from "@alepha/react";
import { Chat } from "./components/Chat.tsx";

export class AppRouter {
  home = $page({
    path: "/",
    component: Chat,
  });
}
