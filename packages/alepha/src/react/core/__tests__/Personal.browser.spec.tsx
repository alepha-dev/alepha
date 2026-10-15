import { Alepha } from "alepha";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";

import { personalRenderedAtom } from "../atoms/personalRenderedAtom.ts";
import Personal from "../components/Personal.tsx";
import { AlephaContext } from "../contexts/AlephaContext.ts";

/**
 * `<Personal>` in the browser (#E78): the hydration pass renders what the
 * server rendered, so there is no mismatch, and the children take over on
 * the next commit.
 */
describe("<Personal> in the browser", () => {
  let root: Root | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    document.body.innerHTML = "";
  });

  const hydrate = async (serverHtml: string, renderedOnServer: boolean) => {
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const alepha = Alepha.create();
    await alepha.start();
    alepha.store.set(personalRenderedAtom, renderedOnServer);

    const errors: unknown[] = [];
    root = hydrateRoot(
      container,
      <AlephaContext.Provider value={alepha}>
        <Personal fallback={<i>slot</i>}>
          <b>menu</b>
        </Personal>
      </AlephaContext.Provider>,
      { onRecoverableError: (error) => errors.push(error) },
    );
    for (let i = 0; i < 50 && container.innerHTML !== "<b>menu</b>"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { container, errors };
  };

  it("hydrates the fallback of a shared page, then renders the children", async ({
    expect,
  }) => {
    const { container, errors } = await hydrate("<i>slot</i>", false);

    expect(errors).toEqual([]);
    expect(container.innerHTML).toBe("<b>menu</b>");
  });

  it("hydrates the children directly when the server rendered them", async ({
    expect,
  }) => {
    const { container, errors } = await hydrate("<b>menu</b>", true);

    expect(errors).toEqual([]);
    expect(container.innerHTML).toBe("<b>menu</b>");
  });
});
