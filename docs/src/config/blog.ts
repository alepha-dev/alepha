import * as generated from "../../.gen/index.ts";
import type { BlogProduct } from "../../scripts/BlogPosts.ts";

/**
 * One post as the site carries it: its body is loaded by its page only.
 */
export interface BlogEntry {
  slug: string;
  date: string;
  title: string;
  description: string;
  product: BlogProduct;
  content: () => Promise<string>;
}

/**
 * Every post of `docs/blog/`, newest first, written by `gen:tree`.
 */
export const posts = generated.posts as BlogEntry[];

/**
 * The filter's choices on `/blog`, in the header's order.
 */
export const blogProducts: Array<{ id: BlogProduct; label: string }> = [
  { id: "framework", label: "Framework" },
  { id: "lore", label: "Lore" },
  { id: "bay", label: "Bay" },
];

/**
 * A product's name as a post's tag shows it.
 */
export const blogProductLabel = (product: BlogProduct): string =>
  blogProducts.find((it) => it.id === product)?.label ?? product;

/**
 * A post's date as the blog prints it, `28 Nov 2026`, the same on the server
 * and in the browser whatever their time zone.
 */
export const blogDate = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export type { BlogProduct };
