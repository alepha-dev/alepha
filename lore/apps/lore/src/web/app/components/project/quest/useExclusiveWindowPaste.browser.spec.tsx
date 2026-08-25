// oxlint-disable react/globals -- Test harness: each case renders throwaway
// components whose only job is to record that their handler ran.
import { render } from "@testing-library/react";
import { act } from "react";
import { describe, it } from "vitest";

import { useExclusiveWindowPaste } from "./useExclusiveWindowPaste.ts";

/**
 * `QuestAttachments` binds its paste handler to `window`, so a screenshot
 * lands without hunting for a drop target. The cost is that EVERY mounted row
 * hears it, and Lore routinely has two: the quest body, and the edit or
 * duplicate sheet open over it. One Ctrl+V therefore uploaded the image twice
 * and produced two attachments.
 */
describe("useExclusiveWindowPaste", () => {
  const Consumer = (props: { onPaste: () => void; enabled?: boolean }) => {
    useExclusiveWindowPaste(() => props.onPaste(), props.enabled ?? true);
    return null;
  };

  const paste = () =>
    act(() => {
      window.dispatchEvent(new Event("paste"));
    });

  it("runs in only the last consumer to mount", async ({ expect }) => {
    const body = { count: 0 };
    const sheet = { count: 0 };

    render(
      <>
        <Consumer onPaste={() => body.count++} />
        <Consumer onPaste={() => sheet.count++} />
      </>,
    );

    paste();

    expect(sheet.count).toBe(1);
    expect(body.count).toBe(0);
  });

  it("hands ownership back when the sheet closes", async ({ expect }) => {
    const body = { count: 0 };
    const sheet = { count: 0 };

    const Screen = (props: { sheetOpen: boolean }) => (
      <>
        <Consumer onPaste={() => body.count++} />
        {props.sheetOpen && <Consumer onPaste={() => sheet.count++} />}
      </>
    );

    const { rerender } = render(<Screen sheetOpen />);
    paste();
    expect(sheet.count).toBe(1);
    expect(body.count).toBe(0);

    rerender(<Screen sheetOpen={false} />);
    paste();

    expect(sheet.count).toBe(1);
    expect(body.count).toBe(1);
  });

  it("keeps its place in the queue across a re-render", async ({ expect }) => {
    const body = { count: 0 };
    const sheet = { count: 0 };

    const Screen = (props: { tick: number }) => (
      <>
        <Consumer onPaste={() => body.count++} />
        <Consumer onPaste={() => sheet.count++} />
        <span>{props.tick}</span>
      </>
    );

    const { rerender } = render(<Screen tick={0} />);
    // A re-render must not re-register: registering by mount order is what
    // decides ownership, and a row that re-subscribed would jump the queue
    // over a sheet that opened after it.
    rerender(<Screen tick={1} />);
    paste();

    expect(sheet.count).toBe(1);
    expect(body.count).toBe(0);
  });

  it("skips a disabled consumer entirely", async ({ expect }) => {
    const body = { count: 0 };
    const sheet = { count: 0 };

    render(
      <>
        <Consumer onPaste={() => body.count++} />
        <Consumer onPaste={() => sheet.count++} enabled={false} />
      </>,
    );

    paste();

    // A completed quest's row is disabled, and must not swallow the paste the
    // row below it would have handled.
    expect(sheet.count).toBe(0);
    expect(body.count).toBe(1);
  });
});
