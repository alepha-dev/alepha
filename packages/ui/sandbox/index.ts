import { run } from "@alepha/core";
import { $page } from "@alepha/react";
import { RootRouter } from "../src";
import ExampleControl from "./examples/ExampleControl.tsx";
import ExampleTypeForm from "./examples/ExampleTypeForm.tsx";

export class AppRouter extends RootRouter {
  home = $page({
    parent: this.root,
    component: ExampleControl,
    path: "/",
  });

  typeform = $page({
    parent: this.root,
    component: ExampleTypeForm,
    path: "/typeform",
  });
}

run(AppRouter);
