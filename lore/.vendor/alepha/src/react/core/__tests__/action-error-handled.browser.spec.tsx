import { renderHook, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import type { ReactNode } from "react";
import { describe, it } from "vitest";

import { AlephaContext } from "../contexts/AlephaContext.ts";
import { useAction } from "../hooks/useAction.ts";
import { useQuery } from "../hooks/useQuery.ts";

/**
 * A caller that passes `onError` has handled the failure (#Q2345).
 *
 * The event used to fire unflagged whatever the caller did, so a mounted
 * `ActionErrorToaster` toasted every `onError: () => {}` written to keep a read
 * quiet, and toasted a second time beside every `onError` that showed its own
 * message. The event still fires for a handled error: error reporting reads it.
 */
describe("react:action:error handled", () => {
  const setup = async () => {
    const alepha = Alepha.create().with(AlephaDateTime);
    await alepha.start();
    const seen: Array<{ error: Error; handled?: boolean }> = [];
    alepha.events.on("react:action:error", (event) => {
      seen.push({ error: event.error, handled: event.handled });
    });
    const wrapper = (props: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>
        {props.children}
      </AlephaContext.Provider>
    );
    return { alepha, seen, wrapper };
  };

  it("is false for a useAction with no onError", async ({ expect }) => {
    const { seen, wrapper } = await setup();
    const error = new Error("unhandled action");
    const { result } = renderHook(
      () =>
        useAction(
          {
            handler: async () => {
              throw error;
            },
          },
          [],
        ),
      { wrapper },
    );

    await result.current.run();

    expect(seen).toEqual([{ error, handled: false }]);
  });

  it("is true for a useAction given an onError, which still runs", async ({
    expect,
  }) => {
    const { seen, wrapper } = await setup();
    const error = new Error("handled action");
    const received: Error[] = [];
    const { result } = renderHook(
      () =>
        useAction(
          {
            handler: async () => {
              throw error;
            },
            onError: (it) => {
              received.push(it);
            },
          },
          [],
        ),
      { wrapper },
    );

    await result.current.run();

    expect(seen).toEqual([{ error, handled: true }]);
    expect(received).toEqual([error]);
  });

  it("is false for a useQuery with no onError", async ({ expect }) => {
    const { seen, wrapper } = await setup();
    const error = new Error("unhandled query");
    renderHook(
      () =>
        useQuery(
          {
            handler: async () => {
              throw error;
            },
          },
          [],
        ),
      { wrapper },
    );

    await waitFor(() => expect(seen).toEqual([{ error, handled: false }]));
  });

  it("is true for a useQuery given an onError, and error still holds it", async ({
    expect,
  }) => {
    const { seen, wrapper } = await setup();
    const error = new Error("quiet query");
    const { result } = renderHook(
      () =>
        useQuery(
          {
            handler: async () => {
              throw error;
            },
            onError: () => {},
          },
          [],
        ),
      { wrapper },
    );

    await waitFor(() => expect(seen).toEqual([{ error, handled: true }]));
    await waitFor(() => expect(result.current.error).toBe(error));
  });
});
