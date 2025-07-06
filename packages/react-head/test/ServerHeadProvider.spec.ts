import { Alepha } from "@alepha/core";
import { test } from "vitest";
import { ServerHeadProvider } from "../src/providers/ServerHeadProvider.ts";

const alepha = Alepha.create();
const serverHeadProvider = alepha.get(ServerHeadProvider);

test("ServerHeadProvider - basic", ({ expect }) => {
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
