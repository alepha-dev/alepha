import type { PageRoute, ReactRouterState } from "@alepha/react";
import { $inject } from "alepha";
import { SeoExpander } from "../helpers/SeoExpander.ts";
import type { Head } from "../interfaces/Head.ts";

export class HeadProvider {
  protected readonly seoExpander = $inject(SeoExpander);

  public global?: Array<Head | (() => Head)> = [];

  public fillHead(state: ReactRouterState) {
    state.head = {
      ...state.head,
    };

    for (const h of this.global ?? []) {
      const head = typeof h === "function" ? h() : h;
      this.mergeHead(state, head);
    }

    for (const layer of state.layers) {
      if (layer.route?.head && !layer.error) {
        this.fillHeadByPage(layer.route, state, layer.props ?? {});
      }
    }
  }

  protected mergeHead(state: ReactRouterState, head: Head): void {
    // Expand SEO fields into meta tags
    const { meta, link } = this.seoExpander.expand(head);
    state.head = {
      ...state.head,
      ...head,
      meta: [...(state.head.meta ?? []), ...meta, ...(head.meta ?? [])],
      link: [...(state.head.link ?? []), ...link, ...(head.link ?? [])],
    };
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

    // Expand SEO fields into meta tags
    const { meta, link } = this.seoExpander.expand(head);
    state.head.meta = [...(state.head.meta ?? []), ...meta];
    state.head.link = [...(state.head.link ?? []), ...link];

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

    if (head.link) {
      state.head.link = [...(state.head.link ?? []), ...(head.link ?? [])];
    }
  }
}
