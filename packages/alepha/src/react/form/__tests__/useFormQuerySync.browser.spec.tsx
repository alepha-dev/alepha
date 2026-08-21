import { renderHook, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { $page, ReactRouter } from "alepha/react/router";
import type { ReactNode } from "react";
import { act } from "react";
import { beforeEach, describe, it } from "vitest";

import { useForm, useFormQuerySync } from "../index.ts";

class App {
  list = $page({
    path: "/list",
    component: () => <div>list</div>,
  });
}

const setup = async () => {
  const alepha = Alepha.create().with(AlephaReact).with(App);
  await alepha.start();
  const router = alepha.inject(ReactRouter);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
  );

  const render = () =>
    renderHook(
      () => {
        const form = useForm({
          id: "filters",
          schema: z.object({ status: z.text().optional() }),
          handler: () => {},
        });
        useFormQuerySync(form, { keys: ["status"] });
        return form;
      },
      { wrapper },
    );

  return { alepha, router, render };
};

describe("useFormQuerySync", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("should write a form change to the URL", async ({ expect }) => {
    // `form:change` carries a slash-prefixed path (`/status`) but the
    // listener filtered on the bare key name, so this direction never fired.
    const { router, render } = await setup();

    await act(async () => {
      await router.push("/list");
    });

    const { result } = render();

    await act(async () => {
      (result.current.input as any).status.set("new");
    });

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("status")).toBe(
        "new",
      );
    });
  });

  it("should keep query params it does not own", async ({ expect }) => {
    // setQueryParams replaces the whole query string, so writing the watched
    // keys used to drop everything else the page had put there.
    const { router, render } = await setup();

    await act(async () => {
      await router.push("/list?tab=open");
    });

    const { result } = render();

    await act(async () => {
      (result.current.input as any).status.set("new");
    });

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("status")).toBe(
        "new",
      );
    });

    expect(new URLSearchParams(window.location.search).get("tab")).toBe("open");
  });
});
