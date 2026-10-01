import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { describe, expect, it } from "vitest";

import { FormModel } from "../services/FormModel.ts";

describe("FormModel.props form method", () => {
  const makeForm = (alepha: Alepha) =>
    alepha.inject(FormModel as any, {
      lifetime: "transient",
      args: [
        "f1",
        {
          id: "f1",
          schema: z.object({ identifier: z.text(), password: z.text() }),
          handler: () => {},
        },
      ],
    }) as FormModel<any>;

  it("declares POST, so a submit that never reaches onSubmit cannot leak fields into the URL", () => {
    // A `<form>` with no `method` defaults to GET, and with no `action` it
    // targets the current URL. Every named input is then serialised into the
    // query string by any submit that happens before `onSubmit` is attached,
    // which is reachable four ways: hydration still in flight on a slow
    // connection, the bundle failing to load, a JS error breaking hydration,
    // and Enter pressed in a text field, which fires implicit submission with
    // no click involved.
    //
    // On a sign-in form that field is called `password`, so the credential
    // ends up in the address bar, in browser history, in the access log and in
    // the next request's `Referer`. Declaring POST turns the same submit into
    // a request the server refuses, which leaks nothing.
    const alepha = Alepha.create().with(AlephaLogger);
    const form = makeForm(alepha);

    expect(form.props.method).toBe("post");
  });

  it("still handles submission itself", () => {
    // The method matters only for submissions this handler never sees. When it
    // is attached it preventDefaults, so the browser never navigates and the
    // declared method is never used.
    const alepha = Alepha.create().with(AlephaLogger);
    const form = makeForm(alepha);

    let defaultPrevented = false;
    form.props.onSubmit({
      preventDefault: () => {
        defaultPrevented = true;
      },
    } as any);

    expect(defaultPrevented).toBe(true);
  });
});
