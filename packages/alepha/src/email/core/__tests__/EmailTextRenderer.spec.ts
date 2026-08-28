import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { EmailTextRenderer } from "../services/EmailTextRenderer.ts";

const render = () => {
  const alepha = Alepha.create();
  return alepha.inject(EmailTextRenderer);
};

describe("EmailTextRenderer", () => {
  it("strips tags and keeps the text", async ({ expect }) => {
    expect(render().fromHtml("<p>Hello there</p>")).toBe("Hello there");
  });

  it("separates block elements with a blank line", async ({ expect }) => {
    expect(render().fromHtml("<p>One</p><p>Two</p>")).toBe("One\n\nTwo");
  });

  it("turns a br into a single newline", async ({ expect }) => {
    expect(render().fromHtml("<p>One<br>Two</p>")).toBe("One\nTwo");
  });

  it("drops script and style content entirely", async ({ expect }) => {
    expect(
      render().fromHtml(
        "<style>p { color: red }</style><p>Visible</p><script>alert(1)</script>",
      ),
    ).toBe("Visible");
  });

  it("keeps a link's destination beside its text", async ({ expect }) => {
    expect(
      render().fromHtml('<a href="https://example.com/x">Click here</a>'),
    ).toBe("Click here (https://example.com/x)");
  });

  it("does not repeat the url when the text already is the url", async ({
    expect,
  }) => {
    expect(
      render().fromHtml(
        '<a href="https://example.com/x">https://example.com/x</a>',
      ),
    ).toBe("https://example.com/x");
  });

  it("decodes the entities that actually appear in mail", async ({
    expect,
  }) => {
    expect(
      render().fromHtml("<p>Tom &amp; Jerry &lt;3 &quot;x&quot;</p>"),
    ).toBe('Tom & Jerry <3 "x"');
  });

  it("treats a non-breaking space as a space", async ({ expect }) => {
    expect(render().fromHtml("<p>a&nbsp;b</p>")).toBe("a b");
  });

  it("collapses runs of whitespace introduced by pretty-printed html", async ({
    expect,
  }) => {
    expect(
      render().fromHtml("<p>\n  Hello\n  there\n</p>\n\n<p>\n  Again\n</p>"),
    ).toBe("Hello there\n\nAgain");
  });

  it("puts each list item on its own line", async ({ expect }) => {
    expect(render().fromHtml("<ul><li>One</li><li>Two</li></ul>")).toBe(
      "One\nTwo",
    );
  });

  it("returns an empty string for markup with no text", async ({ expect }) => {
    expect(render().fromHtml("<div><span></span></div>")).toBe("");
  });

  it("never emits more than one blank line in a row", async ({ expect }) => {
    expect(
      render().fromHtml("<p>One</p><div></div><div></div><p>Two</p>"),
    ).toBe("One\n\nTwo");
  });
});
