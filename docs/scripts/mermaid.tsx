import { renderToStaticMarkup } from "react-dom/server";

import { MermaidFence } from "../../framework/packages/@alepha/ui/src/markdown/diagram/MermaidFence.tsx";

/**
 * A ` ```mermaid ` fence drawn as static SVG at `gen:tree` time, or
 * `undefined` when the renderer would fall back to a code block.
 *
 * The drawing is `@alepha/ui`'s own (`MermaidFence`): the same parsers, the
 * same supported subset and the same refusal policy as every `MarkdownView`,
 * so a diagram that draws in Lore draws here, and one that does not degrades
 * to its fence on both. It is rendered once, on the build machine: a page
 * ships an inline `<svg>` and no diagram code at all.
 *
 * Loaded through Vite (`runnerImport` in `gen-tree.ts`), because the
 * renderer is `.tsx` source, which Node's type stripping cannot read.
 *
 * `index` scopes React's `useId`: the arrowhead `<marker>` ids are global to
 * the document, and each call is a separate React root that would otherwise
 * mint the same ids for every diagram on a page.
 */
export const renderMermaid = (
  source: string,
  index: number,
): string | undefined => {
  const svg = renderToStaticMarkup(
    <MermaidFence source={source} fallback={null} />,
    { identifierPrefix: `mermaid${index}-` },
  );
  return svg || undefined;
};
