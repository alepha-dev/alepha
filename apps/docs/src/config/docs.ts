import * as generated from "../../node_modules/.docs/index.ts";
import type { DocNode } from "../../scripts/docs-cli.ts";

export const docs = generated.docs;

// Add LLM folder to the tree
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
      description: "Full documentation for LLMs",
      asset: "txt",
    },
  ],
};

export const tree: DocNode[] = [...generated.tree, llmFolder];
export const snippets = generated.snippets;
export const repository = {
  name: "feunard/alepha",
};

export type { DocNode };
