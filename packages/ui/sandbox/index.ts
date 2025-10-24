import { run } from "@alepha/core";
import { $page } from "@alepha/react";
import { RootRouter } from "../src";
import ExampleControl from "./examples/ExampleControl.tsx";
import ExampleTypeForm from "./examples/ExampleTypeForm.tsx";
import Playground from "./examples/Playground.tsx";

export class AppRouter extends RootRouter {
  home = $page({
    parent: this.root,
    component: ExampleControl,
    path: "/",
  });

  playground = $page({
    parent: this.root,
    component: Playground,
    path: "/playground",
  });

  typeform = $page({
    parent: this.root,
    component: ExampleTypeForm,
    path: "/typeform",
  });
}

run(AppRouter);
