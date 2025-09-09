import { Alepha } from "@alepha/core";
import { AlephaContext } from "@alepha/react";
import { dom } from "@alepha/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, it, vi } from "vitest";
import { useHead } from "../src";
import type { Head } from "../src/interfaces/Head";

/**
 * @vitest-environment jsdom
 */

describe("useHead", () => {
	const renderWithAlepha = (alepha: Alepha, element: ReactNode) => {
		return dom.render(
			<AlephaContext.Provider value={alepha}>{element}</AlephaContext.Provider>,
		);
	};

	beforeEach(() => {
		// Reset document state before each test
		document.title = "";
		document.head.innerHTML = "";
		document.body.removeAttribute("class");
		document.body.removeAttribute("style");
		document.documentElement.removeAttribute("lang");
		document.documentElement.removeAttribute("class");
	});

	it("should set initial head options on mount", ({ expect }) => {
		const alepha = Alepha.create();
		const TestComponent = () => {
			useHead({
				title: "Test Title",
			});
			return <div>Test</div>;
		};

		renderWithAlepha(alepha, <TestComponent />);

		expect(document.title).toBe("Test Title");
	});

	it("should return current head state and setter function", ({ expect }) => {
		const alepha = Alepha.create();
		let headState: Head;
		let setHeadFn: (head?: Head | ((previous?: Head) => Head)) => void;

		const TestComponent = () => {
			const [head, setHead] = useHead();
			headState = head;
			setHeadFn = setHead;
			return <div>Test</div>;
		};

		renderWithAlepha(alepha, <TestComponent />);

		expect(headState!).toBeDefined();
		expect(setHeadFn!).toBeDefined();
		expect(typeof setHeadFn!).toBe("function");
	});

	it("should update document title when setHead is called", ({ expect }) => {
		const alepha = Alepha.create();
		let setHeadFn: (head?: Head | ((previous?: Head) => Head)) => void;

		const TestComponent = () => {
			const [, setHead] = useHead();
			setHeadFn = setHead;
			return <div>Test</div>;
		};

		renderWithAlepha(alepha, <TestComponent />);

		dom.act(() => {
			setHeadFn({ title: "Updated Title" });
		});

		expect(document.title).toBe("Updated Title");
	});

	it("should update meta tags when setHead is called", ({ expect }) => {
		const alepha = Alepha.create();
		let setHeadFn: (head?: Head | ((previous?: Head) => Head)) => void;

		const TestComponent = () => {
			const [, setHead] = useHead();
			setHeadFn = setHead;
			return <div>Test</div>;
		};

		renderWithAlepha(alepha, <TestComponent />);

		dom.act(() => {
			setHeadFn({
				meta: [
					{ name: "description", content: "Test Description" },
					{ name: "keywords", content: "test, keywords" },
				],
			});
		});

		const descriptionMeta = document.querySelector('meta[name="description"]');
		const keywordsMeta = document.querySelector('meta[name="keywords"]');

		expect(descriptionMeta?.getAttribute("content")).toBe("Test Description");
		expect(keywordsMeta?.getAttribute("content")).toBe("test, keywords");
	});

	it("should update body attributes when setHead is called", ({ expect }) => {
		const alepha = Alepha.create();
		let setHeadFn: (head?: Head | ((previous?: Head) => Head)) => void;

		const TestComponent = () => {
			const [, setHead] = useHead();
			setHeadFn = setHead;
			return <div>Test</div>;
		};

		renderWithAlepha(alepha, <TestComponent />);

		dom.act(() => {
			setHeadFn({
				bodyAttributes: {
					class: "dark-theme",
					style: "background: black;",
				},
			});
		});

		expect(document.body.getAttribute("class")).toBe("dark-theme");
		expect(document.body.getAttribute("style")).toBe("background: black;");
	});

	it("should update html attributes when setHead is called", ({ expect }) => {
		const alepha = Alepha.create();
		let setHeadFn: (head?: Head | ((previous?: Head) => Head)) => void;

		const TestComponent = () => {
			const [, setHead] = useHead();
			setHeadFn = setHead;
			return <div>Test</div>;
		};

		renderWithAlepha(alepha, <TestComponent />);

		dom.act(() => {
			setHeadFn({
				htmlAttributes: {
					lang: "en",
					class: "no-js",
				},
			});
		});

		expect(document.documentElement.getAttribute("lang")).toBe("en");
		expect(document.documentElement.getAttribute("class")).toBe("no-js");
	});

	it("should support functional updates", ({ expect }) => {
		const alepha = Alepha.create();
		let setHeadFn: (head?: Head | ((previous?: Head) => Head)) => void;

		const TestComponent = () => {
			const [, setHead] = useHead({ title: "Initial Title" });
			setHeadFn = setHead;
			return <div>Test</div>;
		};

		renderWithAlepha(alepha, <TestComponent />);

		expect(document.title).toBe("Initial Title");

		dom.act(() => {
			setHeadFn((prev) => ({
				...prev,
				title: `${prev?.title} - Updated`,
			}));
		});

		expect(document.title).toBe("Initial Title - Updated");
	});

	it("should handle multiple head updates", ({ expect }) => {
		const alepha = Alepha.create();
		let setHeadFn: (head?: Head | ((previous?: Head) => Head)) => void;

		const TestComponent = () => {
			const [, setHead] = useHead();
			setHeadFn = setHead;
			return <div>Test</div>;
		};

		renderWithAlepha(alepha, <TestComponent />);

		dom.act(() => {
			setHeadFn({
				title: "First Title",
				meta: [{ name: "description", content: "First Description" }],
			});
		});

		expect(document.title).toBe("First Title");
		expect(
			document
				.querySelector('meta[name="description"]')
				?.getAttribute("content"),
		).toBe("First Description");

		dom.act(() => {
			setHeadFn({
				title: "Second Title",
				meta: [{ name: "description", content: "Second Description" }],
			});
		});

		expect(document.title).toBe("Second Title");
		expect(
			document
				.querySelector('meta[name="description"]')
				?.getAttribute("content"),
		).toBe("Second Description");
	});

	it("should not crash on server-side (non-browser environment)", ({
		expect,
	}) => {
		const alepha = Alepha.create();
		// Mock isBrowser to return false
		vi.spyOn(alepha, "isBrowser").mockReturnValue(false);

		let headState: Head;
		let setHeadFn: (head?: Head | ((previous?: Head) => Head)) => void;

		const TestComponent = () => {
			const [head, setHead] = useHead({ title: "Server Title" });
			headState = head;
			setHeadFn = setHead;
			return <div>Test</div>;
		};

		expect(() => {
			renderWithAlepha(alepha, <TestComponent />);
		}).not.toThrow();

		expect(headState!).toEqual({});

		// setHead should not crash on server
		expect(() => {
			setHeadFn({ title: "New Title" });
		}).not.toThrow();

		// Document title should remain unchanged on server
		expect(document.title).toBe("");
	});

	it("should get current head state from document", ({ expect }) => {
		const alepha = Alepha.create();

		// Pre-populate document with some head data
		document.title = "Existing Title";
		document.body.setAttribute("class", "existing-class");
		document.documentElement.setAttribute("lang", "fr");

		const meta = document.createElement("meta");
		meta.setAttribute("name", "author");
		meta.setAttribute("content", "John Doe");
		document.head.appendChild(meta);

		let headState: Head;

		const TestComponent = () => {
			const [head] = useHead();
			headState = head;
			return <div>Test</div>;
		};

		renderWithAlepha(alepha, <TestComponent />);

		expect(headState!.title).toBe("Existing Title");
		expect(headState!.bodyAttributes?.class).toBe("existing-class");
		expect(headState!.htmlAttributes?.lang).toBe("fr");
		expect(headState!.meta).toContainEqual({
			name: "author",
			content: "John Doe",
		});
	});
});
