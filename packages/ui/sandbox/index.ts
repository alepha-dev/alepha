import { Alepha, run } from "@alepha/core";
import { $page } from "@alepha/react";
import { RootRouter } from "../src";
import ExampleAction from "./examples/ExampleAction.tsx";
import ExampleControl from "./examples/ExampleControl.tsx";
import ExampleDataTable from "./examples/ExampleDataTable.tsx";
import ExampleDialog from "./examples/ExampleDialog.tsx";
import ExampleTypeForm from "./examples/ExampleTypeForm.tsx";
import Playground from "./examples/Playground.tsx";
import Layout from "./Layout.tsx";

export class AppRouter extends RootRouter {
  layout = $page({
    parent: this.root,
    component: Layout,
  });

  home = $page({
    parent: this.layout,
    component: ExampleControl,
    path: "/",
  });

  playground = $page({
    parent: this.layout,
    component: Playground,
    path: "/playground",
  });

  typeform = $page({
    parent: this.layout,
    component: ExampleTypeForm,
    path: "/typeform",
  });

  action = $page({
    parent: this.layout,
    component: ExampleAction,
    path: "/action",
  });

  datatable = $page({
    parent: this.layout,
    component: ExampleDataTable,
    path: "/datatable",
  });

  dialog = $page({
    parent: this.layout,
    component: ExampleDialog,
    path: "/dialog",
  });
}

const alepha = Alepha.create();

alepha.with(AppRouter);

run(alepha);
