import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { ServerHeadProvider } from "../../src/head/providers/ServerHeadProvider.ts";

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
});
