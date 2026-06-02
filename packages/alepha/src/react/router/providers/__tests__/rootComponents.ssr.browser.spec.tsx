import { Alepha } from "alepha";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { ReactRouterState } from "../ReactPageProvider.ts";
import { ReactPageProvider } from "../ReactPageProvider.ts";
import { RootComponentsProvider } from "../RootComponentsProvider.ts";

/**
 * Walk a React element tree (non-circular, element children only) and collect
 * all "data-testid" values found in any element's props.
 */
function collectTestIds(node: any, seen = new Set<any>()): string[] {
  if (!node || typeof node !== "object" || seen.has(node)) {
    return [];
  }
  seen.add(node);

  const ids: string[] = [];

  if (node.props?.["data-testid"]) {
    ids.push(node.props["data-testid"]);
  }

  // Children may be a single node or an array
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      ids.push(...collectTestIds(child, seen));
    }
  } else if (children) {
    ids.push(...collectTestIds(children, seen));
  }

  // Also walk positional children (args 2+ on createElement are spread as props.children
  // but StrictMode wraps with a single child — unwrap one level manually)
  return ids;
}

describe("rootComponents in ReactPageProvider.root", () => {
  it("includes pushed components in the rendered root element tree", () => {
    const alepha = Alepha.create();
    alepha
      .inject(RootComponentsProvider)
      .rootComponents.push(
        createElement("div", { "data-testid": "sigil-marker", key: "m" }),
      );

    const page = alepha.inject(ReactPageProvider);

    const state: ReactRouterState = {
      layers: [{ element: null } as any],
      url: new URL("http://localhost/"),
      onError: () => undefined as any,
      params: {},
      query: {},
      meta: {},
      head: {} as any,
    };

    const element: any = page.root(state);

    // StrictMode wraps the root — unwrap one level
    const inner = element?.props?.children ?? element;
    const ids = collectTestIds(inner);
    expect(ids).toContain("sigil-marker");
  });
});
