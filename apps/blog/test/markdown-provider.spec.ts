import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { MarkdownProvider } from "../src/api/providers/MarkdownProvider.ts";

describe("MarkdownProvider", () => {
  it("should render markdown to HTML", async ({ expect }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(MarkdownProvider);
    await alepha.start();

    const html = provider.render("# Hello World");
    expect(html).toContain("<h1>Hello World</h1>");
  });

  it("should render inline formatting", async ({ expect }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(MarkdownProvider);
    await alepha.start();

    const html = provider.render("**bold** and *italic*");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("should render code blocks", async ({ expect }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(MarkdownProvider);
    await alepha.start();

    const html = provider.render("```typescript\nconst x = 1;\n```");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1;");
  });

  it("should render links", async ({ expect }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(MarkdownProvider);
    await alepha.start();

    const html = provider.render("[Alepha](https://alepha.dev)");
    expect(html).toContain('<a href="https://alepha.dev"');
    expect(html).toContain("Alepha</a>");
  });

  it("should return empty string for empty input", async ({ expect }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(MarkdownProvider);
    await alepha.start();

    const html = provider.render("");
    expect(html).toBe("");
  });
});
