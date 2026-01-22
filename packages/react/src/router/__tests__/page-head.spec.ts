import { $head, AlephaReactHead } from "@alepha/react/head";
import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { $page } from "../index.ts";

class App {
  head = $head({
    htmlAttributes: { lang: "fr", "x-data-custom": "ok" },
  });

  hello = $page({
    head: {
      title: "Hello World",
      bodyAttributes: { class: "hello-world" },
      meta: [
        { name: "description", content: "This is a test page." },
        { name: "keywords", content: "test, alepha, react" },
      ],
    },
    component: () => "",
  });
}

const alepha = Alepha.create().with(AlephaReactHead);
const a = alepha.inject(App);

describe("PageHead", () => {
  it("should render page with custom head and body attributes", async ({
    expect,
  }) => {
    const result = await a.hello.render({ html: true, hydration: false });

    // Check key parts of the HTML output (streaming adds newlines between sections)
    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.html).toContain('<html lang="fr" x-data-custom="ok">');
    expect(result.html).toContain("<title>Hello World</title>");
    expect(result.html).toContain(
      '<meta name="description" content="This is a test page.">',
    );
    expect(result.html).toContain(
      '<meta name="keywords" content="test, alepha, react">',
    );
    expect(result.html).toContain('<body class="hello-world">');
    expect(result.html).toContain('<div id="root">');
    expect(result.html).toContain("</body>");
    expect(result.html).toContain("</html>");
  });
});
