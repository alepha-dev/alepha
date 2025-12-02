import type { PageRoute, ReactRouterState } from "@alepha/react";
import type { Head } from "../interfaces/Head.ts";

export class HeadProvider {
  public global?: Array<Head | (() => Head)> = [];

  public fillHead(state: ReactRouterState) {
    state.head = {
      ...state.head,
    };

    for (const h of this.global ?? []) {
      const head =
        typeof h === "function" ? h() : h;
      state.head = {
        ...state.head,
        ...head,
        meta: [...(state.head.meta ?? []), ...(head.meta ?? [])],
      };
    }

    for (const layer of state.layers) {
      if (layer.route?.head && !layer.error) {
        this.fillHeadByPage(layer.route, state, layer.props ?? {});
      }
    }
  }

  protected fillHeadByPage(
    page: PageRoute,
    state: ReactRouterState,
    props: Record<string, any>,
  ): void {
    if (!page.head) {
      return;
    }

    state.head ??= {};

    const head =
      typeof page.head === "function"
        ? page.head(props, state.head)
        : page.head;

    if (head.title) {
      state.head ??= {};

      if (state.head.titleSeparator) {
        state.head.title = `${head.title}${state.head.titleSeparator}${state.head.title}`;
      } else {
        state.head.title = head.title;
      }

      state.head.titleSeparator = head.titleSeparator;
    }

    if (head.htmlAttributes) {
      state.head.htmlAttributes = {
        ...state.head.htmlAttributes,
        ...head.htmlAttributes,
      };
    }

    if (head.bodyAttributes) {
      state.head.bodyAttributes = {
        ...state.head.bodyAttributes,
        ...head.bodyAttributes,
      };
    }

    if (head.meta) {
      state.head.meta = [...(state.head.meta ?? []), ...(head.meta ?? [])];
    }
  }
}
