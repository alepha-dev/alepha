import { $page } from "alepha/react/router";

import { Layout } from "./Layout.tsx";

/**
 * Every leaf page is `lazy` so each is its own chunk, and every leaf page is
 * `static` so the build prerenders it.
 *
 * `static` is what keeps this site free to run: a prerendered page is served
 * off Cloudflare's asset manifest without invoking the worker at all. Combined
 * with `run_worker_first: ["/api/*"]` in `alepha.config.ts`, the worker exists
 * for sigil ingest and nothing else.
 */
export class AppRouter {
  layout = $page({
    component: Layout,
    children: (): any[] => [
      this.home,
      this.primitives,
      this.blocksTable,
      this.blocksControls,
      this.blocksAutoForm,
      this.blocksFeedback,
      this.blocksButtons,
    ],
  });

  home = $page({
    path: "/",
    static: true,
    head: {
      title: "Alepha UI",
      description:
        "Every component in @alepha/ui, rendered with its variants, on one site.",
    },
    lazy: () => import("./pages/Home.tsx"),
  });

  primitives = $page({
    path: "/primitives",
    static: true,
    head: { title: "Primitives - Alepha UI" },
    lazy: () => import("./pages/Primitives.tsx"),
  });

  blocksTable = $page({
    path: "/blocks/table",
    static: true,
    head: { title: "AlephaTable - Alepha UI" },
    lazy: () => import("./pages/blocks/Table.tsx"),
  });

  blocksControls = $page({
    path: "/blocks/controls",
    static: true,
    head: { title: "Controls - Alepha UI" },
    lazy: () => import("./pages/blocks/Controls.tsx"),
  });

  blocksAutoForm = $page({
    path: "/blocks/auto-form",
    static: true,
    head: { title: "AutoForm - Alepha UI" },
    lazy: () => import("./pages/blocks/AutoFormBlock.tsx"),
  });

  blocksFeedback = $page({
    path: "/blocks/feedback",
    static: true,
    head: { title: "Toasts and dialogs - Alepha UI" },
    lazy: () => import("./pages/blocks/Feedback.tsx"),
  });

  blocksButtons = $page({
    path: "/blocks/buttons",
    static: true,
    head: { title: "Buttons - Alepha UI" },
    lazy: () => import("./pages/blocks/Buttons.tsx"),
  });
}
