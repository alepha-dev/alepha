import { $page } from "@alepha/react";
import { $dictionary } from "@alepha/react/i18n";
import { Icon3dCubeSphere } from "@tabler/icons-react";
import { Alepha, run } from "alepha";
import { createElement } from "react";
import AlephaMantineProvider from "../src/core/components/layout/AlephaMantineProvider.tsx";
import {
  AlephaUI,
  alephaThemeListAtom,
  midnightTheme,
} from "../src/core/index.ts";
import ExampleAction from "./examples/ExampleAction.tsx";
import ExampleControl from "./examples/ExampleControl.tsx";
import ExampleDataTable from "./examples/ExampleDataTable.tsx";
import ExampleDialog from "./examples/ExampleDialog.tsx";
import ExampleTypeForm from "./examples/ExampleTypeForm.tsx";
import ExampleTypeForm2 from "./examples/ExampleTypeForm2.tsx";
import Playground from "./examples/Playground.tsx";
import Layout from "./Layout.tsx";

export class AppRouter {
  public readonly root = $page({
    component: AlephaMantineProvider,
  });

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

  typeform2 = $page({
    parent: this.layout,
    component: ExampleTypeForm2,
    path: "/typeform2",
  });

  action = $page({
    parent: this.layout,
    component: ExampleAction,
    path: "/action",
    description: "List of actions with different types",
    label: "Actions",
    icon: createElement(Icon3dCubeSphere),
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

  en = $dictionary({
    lazy: async () => ({
      default: {
        en: "English",
        fr: "Français",
      },
    }),
  });

  fr = $dictionary({
    lazy: async () => ({
      default: {
        fr: "Français",
        en: "English",
      },
    }),
  });
}

const alepha = Alepha.create();

alepha.with(AlephaUI);
alepha.with(AppRouter);
alepha.set(alephaThemeListAtom, [midnightTheme]);

run(alepha);
