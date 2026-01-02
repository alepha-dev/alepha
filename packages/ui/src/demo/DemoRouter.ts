import { $page } from "@alepha/react";
import {
  IconBinaryTree,
  IconBraces,
  IconHome,
  IconPackages,
} from "@tabler/icons-react";

export class DemoRouter {
  demoLayout = $page({
    icon: IconPackages,
    path: "/demo",
    label: "Demo",
    lazy: () => import("./components/DemoLayout.tsx"),
    children: () => [this.demoHome, this.demoJson],
  });

  demoHome = $page({
    icon: IconHome,
    path: "/",
    label: "Home",
    lazy: () => import("./components/DemoHome.tsx"),
  });

  demoJson = $page({
    icon: IconBraces,
    path: "/json",
    label: "Json",
    children: () => [this.demoJsonViewer],
  });

  demoJsonViewer = $page({
    icon: IconBinaryTree,
    path: "/viewer",
    label: "JsonViewer",
    lazy: () => import("./components/json/DemoJsonViewer.tsx"),
  });
}
