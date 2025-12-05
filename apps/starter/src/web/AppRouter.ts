import { $page } from "@alepha/react";
import { MainRouter } from "@alepha/ui/admin";
import { $client } from "alepha/server/links";
import type { TaskController } from "../api/controllers/TaskController.ts";

export class AppRouter extends MainRouter {
  // do not use $inject() for controllers in the web layer
  // as they might have server-only dependencies
  // instead, use $client() to get a virtual client
  taskController = $client<TaskController>();

  root = $page({
    parent: this.layout,
    children: () => [this.taskCreate, this.home],
    head: {
      title: "Demo App",
      titleSeparator: " | ",
    },
    lazy: () => import("./components/Layout.tsx"),
  });

  taskCreate = $page({
    path: "/add-task",
    head: {
      title: "Add a new Todo",
    },
    lazy: () => import("./components/TodoAdd.tsx"),
  });

  home = $page({
    path: "/",
    head: {
      title: "Todo List",
    },
    // it's a 'loader' in react-router terms, fetch data before rendering
    resolve: async () => ({
      tasks: await this.taskController.getTasks(),
    }),
    // then, lazy load the component
    lazy: () => import("./components/Home.tsx"),
  });
}
