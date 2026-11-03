import { describe, it } from "vitest";

import {
  escapeHtml,
  renderStaticPage,
  STATIC_PAGE_STYLE,
} from "../helpers/staticPage.ts";

describe("renderStaticPage", () => {
  it("wraps the body in one card, under the brand", ({ expect }) => {
    const html = renderStaticPage({
      title: "Done",
      brand: "Lore",
      body: "<h1>Done</h1>",
    });

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).toContain('<div class="brand">Lore</div>');
    expect(html).toContain('<div class="card">\n<h1>Done</h1>\n</div>');
  });

  it("escapes the title and the brand, never the body", ({ expect }) => {
    const html = renderStaticPage({
      title: "<script>",
      brand: "A & B",
      body: "<p>kept</p>",
    });

    expect(html).toContain("<title>&lt;script&gt;</title>");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("<p>kept</p>");
  });

  it("appends a page's own rules after the shared ones", ({ expect }) => {
    const html = renderStaticPage({ title: "t", body: "", style: ".x{}" });

    expect(html).toContain(`<style>${STATIC_PAGE_STYLE}\n.x{}</style>`);
  });

  it("gives buttons a hover and a press, like @alepha/ui", ({ expect }) => {
    expect(STATIC_PAGE_STYLE).toContain(".primary:hover");
    expect(STATIC_PAGE_STYLE).toContain(".secondary:hover");
    expect(STATIC_PAGE_STYLE).toContain(
      "button:not(:disabled):active{transform:translateY(1px)}",
    );
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters HTML reads", ({ expect }) => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
