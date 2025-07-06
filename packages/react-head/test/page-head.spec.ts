import { Alepha } from "@alepha/core";
import { $page } from "@alepha/react";
import { test } from "vitest";
import { AlephaReactHead } from "../src";

class App {
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
const a = alepha.get(App);

test("PageHead - basic", async ({ expect }) => {
	const result = await a.hello.render({ html: true, hydration: false });
	expect(result.html).toBe(
		"<!DOCTYPE html><html lang='en'><head><title>Hello World</title>\n" +
			'<meta name="description" content="This is a test page.">\n' +
			'<meta name="keywords" content="test, alepha, react">\n' +
			'</head><body class="hello-world"></body></html>',
	);
});
