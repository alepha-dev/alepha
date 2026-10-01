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
 * where all 378 of its pages already are; another product would get its own
 * space, so that its guides are its URLs rather than framework pages named
 * after it (quest #1603). The framework is the only one today: Bay and Lore
 * left with their repositories (#E72).
 */
export const docsBase = (product: DocProduct): string =>
  product ? `/${product}/docs` : "/docs";

/**
 * The full path of one doc page.
 */
export const docsHref = (doc: { product: DocProduct; slug: string }): string =>
  `${docsBase(doc.product)}/${doc.slug}`;

/**
 * Every page in one doc set, in tree order. Anything ordered (the sidebar,
 * prev/next) narrows through this rather than the flat `docs` list, so that a
 * second doc set could never be walked into from the end of the first.
 */
export const docsOf = (product: DocProduct) =>
  docs.filter((doc) => doc.product === product);

/**
 * The `llms.txt` of one doc set, as the last entry of its sidebar, at the root
 * of its URL space: `/llms.txt` for the framework. `gen-llms.ts` writes it.
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
};

export const snippets = generated.snippets;
export const repository = {
  name: "alepha-dev/alepha",
};

export type { ChangelogEntry, DocNode, DocProduct };
