import { cleanup, render } from "@testing-library/react";
import { expectAccessible, setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../Resizable.tsx";

/**
 * axe on the resizable panels, under jsdom (#Q3338): the handle is a
 * separator the keyboard can move, so it needs a name and a value.
 */
describe("Resizable passes axe", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("two panels and a handle", async () => {
    render(
      <main>
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize={50}>Left</ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50}>Right</ResizablePanel>
        </ResizablePanelGroup>
      </main>,
    );
    await expectAccessible();
  });
});
