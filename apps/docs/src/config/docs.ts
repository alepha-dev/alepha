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
 * ⚠️ The llm folder stays in the FRAMEWORK tree only, and is not repeated.
 *
 * `llms.txt` and `llms-full.txt` cover the whole site rather than the
 * framework alone, so on the face of it they belong to none of the three
 * trees. Repeating them in all three would offer the same two files from
 * three places and imply three scopes that do not exist; moving them out of
 * the trees entirely would cost them their only link. The framework tree is
 * the one every reader passes through, so that is where they sit - and the
 * `/llms.txt` hrefs are absolute, so nothing about them is product-relative.
 */
const llmFolder: DocNode = {
  slug: "llm",
  name: "llm",
  order: 99,
  children: [
    {
      slug: "llm-llms",
      name: "llms",
      order: 1,
      href: "/llms.txt",
      description: "AI-friendly documentation index",
      asset: "txt",
    },
    {
      slug: "llm-llms-full",
      name: "llms-full",
      order: 2,
      href: "/llms-full.txt",
      description: "Complete documentation for LLMs",
      asset: "txt",
    },
  ],
};

/**
 * One navigation tree per doc set. The sidebar picks by the product of the
 * page it is rendering beside.
 */
export const trees: Record<DocProduct, DocNode[]> = {
  "": [...generated.trees[""], llmFolder],
  bay: generated.trees.bay,
  lore: generated.trees.lore,
};

export const snippets = generated.snippets;
export const repository = {
  name: "alepha-dev/alepha",
};

export type { ChangelogEntry, DocNode, DocProduct };
