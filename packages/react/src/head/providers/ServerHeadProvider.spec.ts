import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { ServerHeadProvider } from "./ServerHeadProvider.ts";

const alepha = Alepha.create();
const serverHeadProvider = alepha.inject(ServerHeadProvider);

describe("ServerHeadProvider", () => {
  it("should render head with custom attributes and meta tags", ({
    expect,
  }) => {
    const template = `
	<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<title>Test</title>
	</head>
	<body>
	</body>
	</html>
	`;

    const head = {
      title: "Test Title",
      htmlAttributes: { lang: "fr", style: "color: red;" },
      bodyAttributes: { class: "test-class" },
      meta: [
        { name: "description", content: "Test description" },
        { name: "keywords", content: "test, example" },
      ],
    };

    const expectedOutput = `
	<!DOCTYPE html>
	<html lang="fr" style="color: red;">
	<head>
		<meta charset="UTF-8">
		<title>Test Title</title>
		<meta name="description" content="Test description">
		<meta name="keywords" content="test, example">
	</head>
	<body class="test-class">
	</body>
	</html>
	`
      .trim()
      .replace(/\s+/g, " ");

    expect(
      serverHeadProvider.renderHead(template, head).replace(/\s+/g, " "),
    ).toBe(expectedOutput);
  });

  it("should render script tags with src attribute", ({ expect }) => {
    const template = `<!DOCTYPE html><html><head></head><body></body></html>`;

    const head = {
      script: [{ src: "https://example.com/script.js" }],
    };

    const result = serverHeadProvider.renderHead(template, head);
    expect(result).toContain(
      '<script src="https://example.com/script.js"></script>',
    );
  });

  it("should render script tags with async and defer as boolean attributes", ({
    expect,
  }) => {
    const template = `<!DOCTYPE html><html><head></head><body></body></html>`;

    const head = {
      script: [
        { src: "https://example.com/async.js", async: true } as Record<
          string,
          string | boolean
        >,
        { src: "https://example.com/defer.js", defer: true } as Record<
          string,
          string | boolean
        >,
      ],
    };

    const result = serverHeadProvider.renderHead(template, head);
    expect(result).toContain(
      '<script src="https://example.com/async.js" async></script>',
    );
    expect(result).toContain(
      '<script src="https://example.com/defer.js" defer></script>',
    );
  });

  it("should render script tags with type and crossorigin attributes", ({
    expect,
  }) => {
    const template = `<!DOCTYPE html><html><head></head><body></body></html>`;

    const head = {
      script: [
        {
          src: "https://example.com/module.js",
          type: "module",
          crossorigin: "anonymous",
        },
      ],
    };

    const result = serverHeadProvider.renderHead(template, head);
    expect(result).toContain('type="module"');
    expect(result).toContain('crossorigin="anonymous"');
  });

  it("should render multiple script tags", ({ expect }) => {
    const template = `<!DOCTYPE html><html><head></head><body></body></html>`;

    type ScriptAttrs = Record<string, string | boolean>;
    const head = {
      script: [
        { src: "https://example.com/first.js" } as ScriptAttrs,
        { src: "https://example.com/second.js", defer: true } as ScriptAttrs,
        { src: "https://example.com/third.js", type: "module" } as ScriptAttrs,
      ],
    };

    const result = serverHeadProvider.renderHead(template, head);
    expect(result).toContain(
      '<script src="https://example.com/first.js"></script>',
    );
    expect(result).toContain(
      '<script src="https://example.com/second.js" defer></script>',
    );
    expect(result).toContain('src="https://example.com/third.js"');
    expect(result).toContain('type="module"');
  });

  it("should not render script attributes with false value", ({ expect }) => {
    const template = `<!DOCTYPE html><html><head></head><body></body></html>`;

    const head = {
      script: [{ src: "https://example.com/script.js", defer: false }],
    };

    const result = serverHeadProvider.renderHead(template, head);
    expect(result).toContain(
      '<script src="https://example.com/script.js"></script>',
    );
    expect(result).not.toContain("defer");
  });

  it("should escape HTML in script attributes", ({ expect }) => {
    const template = `<!DOCTYPE html><html><head></head><body></body></html>`;

    const head = {
      script: [{ src: 'https://example.com/script.js?a=1&b="2"' }],
    };

    const result = serverHeadProvider.renderHead(template, head);
    expect(result).toContain("&amp;");
    expect(result).toContain("&quot;");
  });
});
