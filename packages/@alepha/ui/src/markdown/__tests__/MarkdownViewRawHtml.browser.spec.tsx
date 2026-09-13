import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownView } from "../markdown-view.tsx";

/**
 * `rehypeSafeImg` promoted a lone `<img …>` raw node to a real element, and
 * existed for exactly one reason: MDXEditor serialised a *resized* image as
 * `<img width="…" src="…" />`. With the resize handles gone nothing produces
 * that markup, so the plugin was deleted and react-markdown's default —
 * escape every raw node to text — is restored.
 *
 * These pin that default. It is the entire raw-HTML posture of every
 * markdown surface in every app built on this package: content is authored
 * by one user and rendered to another, so a raw tag becoming live markup is
 * an injection point. A future change that reaches for `rehype-raw`, or
 * re-adds a promoting plugin, turns these red — which is the point.
 */
describe("MarkdownView raw HTML", () => {
  it("escapes a raw img instead of promoting it to an element", () => {
    const { container } = render(
      <MarkdownView content={'<img src="assets/a.webp" width="600" />'} />,
    );

    expect(container.querySelector("img")).toBeNull();
  });

  it("escapes an img carrying an event handler", () => {
    const { container } = render(
      <MarkdownView content={'<img src="x" onerror="alert(1)" />'} />,
    );

    expect(container.querySelector("img")).toBeNull();
  });

  it("escapes every other raw tag too", () => {
    const { container } = render(
      <MarkdownView content={'<button onclick="alert(1)">hi</button>'} />,
    );

    expect(container.querySelector("button")).toBeNull();
  });

  it("still renders real markdown around the escaped HTML", () => {
    render(<MarkdownView content={"# Title\n\n<img src='a' />"} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Title");
  });
});
