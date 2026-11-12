import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { expectAccessible } from "../accessible.ts";

describe("expectAccessible", () => {
  afterEach(() => {
    cleanup();
  });

  it("fails on a button with no accessible name, naming the rule and the node", async ({
    expect,
  }) => {
    render(<button type="button" id="nameless" />);
    await expect(expectAccessible()).rejects.toThrow(/\[button-name\]/);
    await expect(expectAccessible()).rejects.toThrow(/#nameless/);
    await expect(expectAccessible()).rejects.toThrow(
      /dequeuniversity\.com\/rules\/axe\/[\d.]+\/button-name/,
    );
  });

  it("passes on a labelled button", async ({ expect }) => {
    render(<button type="button">Save</button>);
    await expect(expectAccessible()).resolves.toBeUndefined();
  });

  it("scans document.body by default, so a portalled node is seen", async ({
    expect,
  }) => {
    const outside = document.createElement("div");
    outside.innerHTML = `<button type="button" id="portalled"></button>`;
    document.body.append(outside);
    render(<button type="button">Save</button>);
    try {
      await expect(expectAccessible()).rejects.toThrow(/#portalled/);
    } finally {
      outside.remove();
    }
  });

  it("scans only the target when one is given", async ({ expect }) => {
    const { container } = render(
      <div>
        <button type="button">Save</button>
      </div>,
    );
    const outside = document.createElement("div");
    outside.innerHTML = `<button type="button"></button>`;
    document.body.append(outside);
    try {
      await expect(expectAccessible(container)).resolves.toBeUndefined();
    } finally {
      outside.remove();
    }
  });

  it("switches a rule off for one call", async ({ expect }) => {
    render(<button type="button" />);
    await expect(
      expectAccessible(undefined, { disable: ["button-name"] }),
    ).resolves.toBeUndefined();
  });

  it("never reports contrast, which jsdom cannot compute", async ({
    expect,
  }) => {
    render(
      <p style={{ color: "#eeeeee", backgroundColor: "#ffffff" }}>
        Low contrast text
      </p>,
    );
    await expect(expectAccessible()).resolves.toBeUndefined();
  });
});
