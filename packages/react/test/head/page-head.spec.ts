import { $page } from "@alepha/react";
import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { $head, AlephaReactHead } from "../../src/head";

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
    expect(result.html).toBe(
      '<!DOCTYPE html><html lang="fr" x-data-custom="ok"><head><title>Hello World</title>\n' +
        '<meta name="description" content="This is a test page.">\n' +
        '<meta name="keywords" content="test, alepha, react">\n' +
        '</head><body class="hello-world"></body></html>',
    );
  });
});
