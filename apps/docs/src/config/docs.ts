import * as generated from "../../.gen/index.ts";
import type { ChangelogEntry, DocNode } from "../../scripts/interfaces.ts";

export const docs = generated.docs;
export const changelog: ChangelogEntry[] = generated.changelog;

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

export const tree: DocNode[] = [...generated.tree, llmFolder];
export const snippets = generated.snippets;
export const repository = {
  name: "feunard/alepha",
};

export type { ChangelogEntry, DocNode };
