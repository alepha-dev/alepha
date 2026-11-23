import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { useStreamReveal } from "./useStreamReveal.ts";

interface ProbeProps {
  text: string;
  streaming: boolean;
}

const Probe = (props: ProbeProps) => (
  <p data-testid="shown">{useStreamReveal(props.text, props.streaming)}</p>
);

const shown = () => screen.getByTestId("shown").textContent ?? "";

const LONG =
  "The release is blocked by two quests that are still open. ".repeat(6);

/**
 * A streamed @lore answer types itself out (#Q4190): a burst the stream
 * delivers is revealed over a few frames instead of appearing at once, and
 * text that arrives finished is never animated.
 */
describe("useStreamReveal", () => {
  const matchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = matchMedia;
  });

  it("reveals a streaming burst progressively, then all of it", async ({
    expect,
  }) => {
    const view = render(<Probe text="" streaming />);
    view.rerender(<Probe text={LONG} streaming />);

    // The burst is not shown whole on the frame it arrives.
    expect(shown().length).toBeLessThan(LONG.length);
    await waitFor(() => expect(shown()).toBe(LONG));
  });

  it("never cuts a word while revealing", async ({ expect }) => {
    const view = render(<Probe text="" streaming />);
    view.rerender(<Probe text={LONG} streaming />);
    const seen: string[] = [];
    await waitFor(() => {
      seen.push(shown());
      expect(shown()).toBe(LONG);
    });
    for (const partial of seen.filter((it) => it && it !== LONG)) {
      expect(LONG.startsWith(partial)).toBe(true);
      expect(LONG[partial.length]).toBe(" ");
    }
  });

  it("shows a finished message at once, as history does", ({ expect }) => {
    render(<Probe text={LONG} streaming={false} />);

    expect(shown()).toBe(LONG);
  });

  it("shows everything at once under prefers-reduced-motion", ({ expect }) => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const view = render(<Probe text="" streaming />);
    view.rerender(<Probe text={LONG} streaming />);

    expect(shown()).toBe(LONG);
  });

  it("shows an edit at once rather than retyping it", ({ expect }) => {
    const view = render(<Probe text="" streaming />);
    view.rerender(<Probe text={LONG} streaming />);
    view.rerender(<Probe text="Something else entirely." streaming={false} />);

    expect(shown()).toBe("Something else entirely.");
  });
});
