import * as generated from "../../.gen/index.ts";
import type {
  ChangelogEntry,
  DocNode,
  DocProduct,
} from "../../scripts/interfaces.ts";

/**
 * ⚠️ `product` is narrowed here, not in `.gen/`.
 *
 * The generated file is JSON written through `JSON.stringify`, so every
 * string field arrives as `string` and `product` widens out of its union.
 * Narrowing it once at the boundary is what lets `docsOf` / `docsHref` and
 * the `Docs` component take a `DocProduct` rather than a bare string.
 */
export const docs = generated.docs as Array<
  (typeof generated.docs)[number] & { product: DocProduct }
>;
export const changelog: ChangelogEntry[] = generated.changelog;

/**
 * The URL prefix a doc set lives under. Framework keeps `/docs`, which is
 * where all 378 of its pages already are; each product gets its own space so
 * a Bay guide is a Bay URL rather than a framework page named `bay-`
 * something (quest #1603).
 */
export const docsBase = (product: DocProduct): string =>
  product ? `/${product}/docs` : "/docs";

/**
 * The full path of one doc page.
 */
export const docsHref = (doc: { product: DocProduct; slug: string }): string =>
  `${docsBase(doc.product)}/${doc.slug}`;

/**
 * Every page in one doc set, in tree order. The flat `docs` list holds all
 * three, so anything ordered - the sidebar, prev/next - has to narrow first
 * or it walks out of one product and into the next.
 */
export const docsOf = (product: DocProduct) =>
  docs.filter((doc) => doc.product === product);

/**
 * The `llms.txt` of one doc set, as the last entry of its sidebar.
 *
 * Each product has its own, at the root of its URL space (`/llms.txt`,
 * `/bay/llms.txt`, `/lore/llms.txt`), so each sidebar offers the one that
 * describes what the reader is looking at. `gen-llms.ts` writes all three.
 */
const llmFolder = (product: DocProduct): DocNode => ({
  slug: "llm",
  name: "llm",
  order: 99,
  children: [
    {
      slug: "llm-llms",
      name: "llms",
      order: 1,
      href: product ? `/${product}/llms.txt` : "/llms.txt",
      description: "AI-friendly documentation index",
      asset: "txt",
    },
  ],
});

/**
 * One navigation tree per doc set. The sidebar picks by the product of the
 * page it is rendering beside.
 */
export const trees: Record<DocProduct, DocNode[]> = {
  "": [...generated.trees[""], llmFolder("")],
  bay: [...generated.trees.bay, llmFolder("bay")],
  lore: [...generated.trees.lore, llmFolder("lore")],
};

export const snippets = generated.snippets;
export const repository = {
  name: "alepha-dev/alepha",
};

export type { ChangelogEntry, DocNode, DocProduct };
