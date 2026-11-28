import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const distDir = join(process.cwd(), "dist/public");

/**
 * The blog: posts from `docs/blog/`, prerendered at `/blog` and
 * `/blog/:slug`, with a feed, markdown copies and `llms.txt` entries
 * (#Q4557). Driven by the first post, which every later one keeps reachable.
 */
const SLUG = "agent-job-logs-five-times-smaller";

test.describe("Blog", () => {
  test("/blog lists the posts, and the product filter narrows them", async ({
    page,
  }) => {
    await page.goto("/blog");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Blog");
    const list = page.getByRole("list", { name: "Posts" });
    const post = list.getByRole("link", { name: /Agent job logs/ });
    await expect(post).toBeVisible();

    const filter = page.getByRole("group", { name: "Filter posts by product" });
    await filter.getByRole("button", { name: "Bay" }).click();
    await expect(post).toHaveCount(0);
    await filter.getByRole("button", { name: "Lore" }).click();
    await expect(post).toBeVisible();
    await filter.getByRole("button", { name: "All" }).click();
    await expect(post).toBeVisible();

    await post.click();
    await expect(page).toHaveURL(new RegExp(`/blog/${SLUG}$`));
  });

  test("a post is prerendered with its title, date, body and alternates", async ({
    page,
  }) => {
    expect(existsSync(join(distDir, "blog.html"))).toBe(true);
    expect(existsSync(join(distDir, `blog/${SLUG}.html`))).toBe(true);

    await page.goto(`/blog/${SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Agent job logs, five times smaller",
    );
    await expect(page.locator("time")).toHaveAttribute(
      "datetime",
      "2026-11-28",
    );
    await expect(
      page.getByRole("heading", { name: "Where the bytes were" }),
    ).toBeVisible();
    await expect(
      page.locator(`link[rel='alternate'][href='/blog/${SLUG}.md']`),
    ).toHaveCount(1);
    await expect(
      page.locator("link[rel='alternate'][type='application/rss+xml']"),
    ).toHaveCount(1);
  });

  test("the feed, the markdown copy and llms.txt carry the post", async ({
    request,
  }) => {
    const rss = readFileSync(join(distDir, "blog/rss.xml"), "utf-8");
    expect(rss).toContain('<rss version="2.0"');
    expect(rss).toContain(`/blog/${SLUG}</link>`);

    const markdown = await request.get(`/blog/${SLUG}.md`);
    expect(markdown.status()).toBe(200);
    expect(await markdown.text()).toContain(
      "# Agent job logs, five times smaller",
    );

    const llms = readFileSync(join(distDir, "llms.txt"), "utf-8");
    expect(llms).toContain("## Blog");
    expect(llms).toContain(`/blog/${SLUG}.md)`);
  });

  test("the header links to the blog, and the front page shows the latest posts", async ({
    page,
  }) => {
    await page.goto("/");
    // Three at most, newest first: the first post is among them only while
    // two or fewer were published after it, so this asserts the shape.
    const latest = page.getByRole("list", { name: "Latest posts" });
    const links = latest.getByRole("link");
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
    await expect(links.first()).toHaveAttribute("href", /^\/blog\/[a-z0-9-]+$/);

    const nav = page.getByRole("navigation", { name: "Products" });
    await nav.getByRole("link", { name: "Blog" }).click();
    await expect(page).toHaveURL(/\/blog$/);
    await expect(nav.getByRole("link", { name: "Blog" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
