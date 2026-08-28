import { describe, it } from "vitest";

import { render } from "../index.ts";

interface GreetingProps {
  name: string;
}

const Greeting = (props: GreetingProps) => (
  <html lang="en">
    <body>
      <h1>Hello {props.name}</h1>
    </body>
  </html>
);

const WithImage = () => (
  <html lang="en">
    <body>
      <img src="https://example.com/logo.png" alt="logo" />
      <p>Body</p>
    </body>
  </html>
);

const Broken = () => {
  throw new Error("template exploded");
};

describe("alepha/react/email render()", () => {
  it("renders a component to an html string", async ({ expect }) => {
    const html = await render(Greeting)({ name: "Alice" });

    expect(html).toContain("Hello ");
    expect(html).toContain("Alice");
  });

  it("prepends the doctype email clients expect", async ({ expect }) => {
    const html = await render(Greeting)({ name: "Alice" });

    expect(html.startsWith("<!DOCTYPE html PUBLIC")).toBe(true);
    expect(html).toContain("XHTML 1.0 Transitional");
  });

  it("emits exactly one doctype", async ({ expect }) => {
    const html = await render(Greeting)({ name: "Alice" });

    expect(html.match(/<!DOCTYPE/gi)).toHaveLength(1);
  });

  it("strips the image preload links React 19 injects", async ({ expect }) => {
    const html = await render(WithImage)({});

    expect(html).not.toContain('rel="preload"');
    expect(html).toContain("logo.png");
  });

  it("keeps a stylesheet link that is not an image preload", async ({
    expect,
  }) => {
    const Styled = () => (
      <html lang="en">
        <head>
          <link rel="stylesheet" href="https://example.com/x.css" />
        </head>
        <body>
          <p>Body</p>
        </body>
      </html>
    );

    const html = await render(Styled)({});

    expect(html).toContain('rel="stylesheet"');
  });

  it("rejects when the component throws, rather than returning half a page", async ({
    expect,
  }) => {
    await expect(render(Broken)({})).rejects.toThrowError(/template exploded/);
  });

  it("returns a reusable renderer, not a one-shot", async ({ expect }) => {
    const renderGreeting = render(Greeting);

    const first = await renderGreeting({ name: "Alice" });
    const second = await renderGreeting({ name: "Bob" });

    expect(first).toContain("Alice");
    expect(second).toContain("Bob");
    expect(first).not.toContain("Bob");
  });

  it("waits for a suspended subtree before returning", async ({ expect }) => {
    const Slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return <p>Arrived late</p>;
    };

    const Page = () => (
      <html lang="en">
        <body>
          <Slow />
        </body>
      </html>
    );

    const html = await render(Page)({});

    expect(html).toContain("Arrived late");
  });
});
