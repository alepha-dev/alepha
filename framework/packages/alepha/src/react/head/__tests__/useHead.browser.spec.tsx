import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { act, type ReactNode } from "react";
import { beforeEach, describe, it, vi } from "vitest";

import type { Head } from "../index.ts";
import { useHead } from "../index.ts";

describe("useHead", () => {
  const renderWithAlepha = (alepha: Alepha, element: ReactNode) => {
    return render(
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

  it("should update document title when setHead is called", ({ expect }) => {
    const alepha = Alepha.create();
    let setHeadFn: (head?: Head | ((previous?: Head) => Head)) => void;

    const TestComponent = () => {
      const [, setHead] = useHead();
      setHeadFn = setHead;
      return <div>Test</div>;
    };

    renderWithAlepha(alepha, <TestComponent />);

    act(() => {
      setHeadFn({ title: "Updated Title" });
    });

    expect(document.title).toBe("Updated Title");
  });

  it("expands SEO fields into their tags, like a page head", ({ expect }) => {
    const alepha = Alepha.create();
    const TestComponent = () => {
      useHead({
        title: "Article",
        description: "What it says",
        url: "https://example.com/article",
        meta: [{ name: "robots", content: "noindex" }],
      });
      return <div>Test</div>;
    };

    renderWithAlepha(alepha, <TestComponent />);

    const content = (selector: string) =>
      document.querySelector(selector)?.getAttribute("content");
    expect(content('meta[name="description"]')).toBe("What it says");
    expect(content('meta[property="og:title"]')).toBe("Article");
    expect(content('meta[property="og:description"]')).toBe("What it says");
    expect(content('meta[name="twitter:description"]')).toBe("What it says");
    expect(content('meta[name="robots"]')).toBe("noindex");
    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ).toBe("https://example.com/article");
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

    act(() => {
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

    act(() => {
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

    act(() => {
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
    // alepha-allow no-vi-mock: isBrowser() reads `typeof window`, which jsdom always defines, and the container has no seam to declare a server render inside a browser spec
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
