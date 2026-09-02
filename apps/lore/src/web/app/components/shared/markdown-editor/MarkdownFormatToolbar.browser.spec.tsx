import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { I18n } from "../../../services/I18n.ts";
import MarkdownEditorInner from "./MarkdownEditorInner.tsx";

/**
 * The fixed formatting bar above a description field (feedback #2056).
 *
 * CodeMirror constructs under jsdom (it only fails to measure), so
 * `onViewReady` fires, the bar mounts, and a button really does run its
 * command against the document. The floating selection toolbar is untouched
 * and still mounted beside it.
 */
describe("MarkdownFormatToolbar", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: ReactElement) => {
    alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  it("mounts above the editor in edit mode and applies a command on click", async () => {
    const changes: string[] = [];
    await mount(
      <MarkdownEditorInner
        value=""
        onChange={(value) => changes.push(value)}
        mode="edit"
        formatToolbar
      />,
    );

    const bar = await screen.findByTestId("markdown-format-toolbar");
    expect(bar.getAttribute("role")).toBe("toolbar");
    // The whole shared table, link included.
    for (const name of [
      "Bold",
      "Italic",
      "Inline code",
      "Link",
      "Heading 1",
      "Quote",
      "Code block",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }

    // `mousedown`, the event the bar listens to so the editor keeps its
    // selection. An empty document gains the bold markers.
    fireEvent.mouseDown(screen.getByRole("button", { name: "Bold" }));
    await waitFor(() => expect(changes[changes.length - 1]).toBe("****"));
  });

  it("is absent unless asked for, and absent in preview", async () => {
    const { container, rerender } = await mount(
      <MarkdownEditorInner value="x" onChange={() => {}} mode="edit" />,
    );
    expect(screen.queryByTestId("markdown-format-toolbar")).toBeNull();
    expect(container.querySelector(".lore-md-edit")).toBeTruthy();

    rerender(
      <AlephaContext.Provider value={alepha!}>
        <MarkdownEditorInner
          value="x"
          onChange={() => {}}
          mode="view"
          formatToolbar
        />
      </AlephaContext.Provider>,
    );
    expect(screen.queryByTestId("markdown-format-toolbar")).toBeNull();
  });
});
