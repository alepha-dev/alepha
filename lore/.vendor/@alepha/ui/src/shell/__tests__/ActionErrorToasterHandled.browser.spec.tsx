import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact, useAction, useQuery } from "alepha/react";
import { FormValidationError, useForm, useFormState } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdminFiles } from "../../admin/AdminFiles.tsx";
import { Toaster } from "../../core/Toaster.tsx";
import { DialogProvider } from "../../core/useDialog.tsx";
import { useToast } from "../../core/useToast.tsx";
import { ActionErrorToaster } from "../ActionErrorToaster.tsx";

/**
 * A failure its caller handled does not toast; every other failure toasts
 * exactly once (#Q2345).
 *
 * Driven through the real hooks rather than a hand-emitted event, because the
 * bug lived in the hooks: `useAction` and `FormModel` emitted
 * `react:action:error` whatever the caller did, so a mounted toaster showed
 * every `onError: () => {}` meant to stay quiet, a second toast beside every
 * `onError` that showed its own, and a field error under its field AND as a
 * toast. Each case below is the shape of a real call site, named on it.
 *
 * Every test uses its own message text: sonner's toast store is module-level,
 * so what one test raises is still there for the next one to find.
 */
describe("ActionErrorToaster and handled errors", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: ReactNode, links?: typeof LinkProvider) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    if (links) {
      alepha
        .with({ provide: LinkProvider, use: links })
        .with(AlephaReactRouter);
    }
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <Toaster visibleToasts={20} />
        <ActionErrorToaster />
        {ui}
      </AlephaContext.Provider>,
    );
  };

  /**
   * Long enough for an emitted event to have reached sonner, so the absence
   * of a toast is an answer and not a race.
   */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

  it("skips a handled event before its filter runs", async () => {
    const filtered: string[] = [];
    await mount(null);
    const app = alepha!;
    alepha = undefined;
    const view = render(
      <AlephaContext.Provider value={app}>
        <ActionErrorToaster
          filter={(error) => {
            filtered.push(error.message);
            return true;
          }}
        />
      </AlephaContext.Provider>,
    );

    await app.events.emit("react:action:error", {
      type: "custom",
      error: new Error("Handled before the filter"),
      handled: true,
    });
    await app.events.emit("react:action:error", {
      type: "custom",
      error: new Error("Reaches the filter"),
    });

    await waitFor(() =>
      expect(screen.getAllByText("Reaches the filter")).toHaveLength(1),
    );
    expect(filtered).toEqual(["Reaches the filter"]);
    expect(screen.queryByText("Handled before the filter")).toBeNull();

    view.unmount();
    await app.stop();
  });

  it("toasts a useAction with no onError exactly once", async () => {
    const Save = () => {
      const save = useAction(
        {
          handler: async () => {
            throw new Error("Action refused by the server");
          },
        },
        [],
      );
      return <button onClick={() => save.run()}>save</button>;
    };
    await mount(<Save />);

    fireEvent.click(screen.getByText("save"));

    await waitFor(() =>
      expect(screen.getAllByText("Action refused by the server")).toHaveLength(
        1,
      ),
    );
  });

  /**
   * `AdminUserDetail.tsx`'s user query: its `onError` toasts a translated
   * message by hand. It showed that message and the error's own.
   */
  it("shows only the onError's own toast for a useQuery that toasts by hand", async () => {
    const UserDetail = () => {
      const toast = useToast();
      useQuery(
        {
          handler: async () => {
            throw new Error("Query raw message");
          },
          onError: () => {
            toast.error("Failed to load user, by hand");
          },
        },
        [],
      );
      return null;
    };
    await mount(<UserDetail />);

    await waitFor(() =>
      expect(screen.getAllByText("Failed to load user, by hand")).toHaveLength(
        1,
      ),
    );
    await settle();
    expect(screen.queryByText("Query raw message")).toBeNull();
  });

  /**
   * `ProjectCreate.tsx`'s wizard form: `onError` toasts `error.message`
   * itself, then puts the wizard back a step. Twice under a root toaster.
   */
  it("toasts a useForm whose onError toasts the same message exactly once", async () => {
    const Wizard = () => {
      const toast = useToast();
      const form = useForm({
        schema: z.object({ title: z.text() }),
        onError: (error) => {
          toast.error(error.message);
        },
        handler: () => {
          throw new Error("That slug is taken");
        },
      });
      return (
        <form {...form.props} data-testid="wizard">
          <input {...form.input.title.props} data-testid="title" />
        </form>
      );
    };
    await mount(<Wizard />);

    fireEvent.change(screen.getByTestId("title"), {
      target: { value: "Atlas" },
    });
    fireEvent.submit(screen.getByTestId("wizard"));

    await waitFor(() =>
      expect(screen.getAllByText("That slug is taken")).toHaveLength(1),
    );
    await settle();
    expect(screen.getAllByText("That slug is taken")).toHaveLength(1);
  });

  /**
   * `AuthLogin.tsx`'s wrong password: the handler throws a
   * `FormValidationError` on `/password`, shown under the field.
   */
  it("shows a field FormValidationError under its field and does not toast it", async () => {
    const Login = () => {
      const form = useForm({
        schema: z.object({ password: z.text() }),
        handler: () => {
          throw new FormValidationError({
            message: "Invalid identifier or password, here",
            path: "/password",
          });
        },
      });
      const state = useFormState({ form, path: "/password" }, ["error"]);
      return (
        <form {...form.props} data-testid="login">
          <input {...form.input.password.props} data-testid="password" />
          <p data-testid="password-error">{state.error?.message}</p>
        </form>
      );
    };
    await mount(<Login />);

    fireEvent.change(screen.getByTestId("password"), {
      target: { value: "wrong" },
    });
    fireEvent.submit(screen.getByTestId("login"));

    // The toast would read the error's own message, which is also what the
    // field renders here: so one element with that text means no toast.
    const message =
      "Invalid input: Invalid identifier or password, here at /password";
    await waitFor(() =>
      expect(screen.getByTestId("password-error").textContent).toBe(message),
    );
    await settle();
    expect(screen.getAllByText(message)).toHaveLength(1);
  });

  it("toasts a useForm plain throw exactly once", async () => {
    const Plain = () => {
      const form = useForm({
        schema: z.object({ name: z.text() }),
        handler: () => {
          throw new Error("Form fault with no handler");
        },
      });
      return (
        <form {...form.props} data-testid="plain">
          <input {...form.input.name.props} data-testid="name" />
        </form>
      );
    };
    await mount(<Plain />);

    fireEvent.change(screen.getByTestId("name"), { target: { value: "x" } });
    fireEvent.submit(screen.getByTestId("plain"));

    await waitFor(() =>
      expect(screen.getAllByText("Form fault with no handler")).toHaveLength(1),
    );
  });

  /**
   * Components reading one keyed `useQuery` share its request, so one
   * rejection reaches each of them and each emits the event with the same
   * error (#Q2317). Lore's bay pages read one inventory from several panels.
   */
  it("toasts a failure shared by two readers of one keyed query once", async () => {
    let calls = 0;
    const Panel = () => {
      useQuery(
        {
          key: ["shared-inventory"],
          handler: async () => {
            calls++;
            await new Promise((resolve) => setTimeout(resolve, 20));
            throw new Error("Inventory unreachable, shared");
          },
        },
        [],
      );
      return null;
    };
    await mount(
      <>
        <Panel />
        <Panel />
      </>,
    );

    await waitFor(() =>
      expect(screen.getAllByText("Inventory unreachable, shared")).toHaveLength(
        1,
      ),
    );
    await settle();
    expect(calls).toBe(1);
    expect(screen.getAllByText("Inventory unreachable, shared")).toHaveLength(
      1,
    );
  });

  /**
   * The real `AdminFiles`: its bucket stats query passes `onError: () => {}`,
   * because the bucket filter degrades to empty without them, and so does its
   * summary, whose four figures read the same endpoint (#Q2409): the page
   * works without either. `ShowcaseFilesController` in `apps/ui` relies on
   * that leaving "no error anywhere".
   */
  it("keeps AdminFiles' failed bucket stats quiet", async () => {
    let statsCalls = 0;
    class FailingStatsLinks extends LinkProvider {
      override client(): any {
        const actions: Record<string, any> = {
          getFileStats: async () => {
            statsCalls++;
            throw new Error("Bucket stats unavailable");
          },
          findFiles: async () => ({
            content: [],
            page: {
              number: 0,
              size: 25,
              totalElements: 0,
              totalPages: 0,
              isFirst: true,
              isLast: true,
            },
          }),
        };
        return new Proxy({} as Record<string, unknown>, {
          get: (_target, key: string) => {
            const action: any = actions[key] ?? (async () => ({}));
            action.can = () => true;
            return action;
          },
        });
      }
    }
    await mount(
      <DialogProvider>
        <AdminFiles />
      </DialogProvider>,
      FailingStatsLinks,
    );

    // Both reads: the bucket filter's and the summary's.
    await waitFor(() => expect(statsCalls).toBe(2));
    await settle();
    expect(screen.queryByText("Bucket stats unavailable")).toBeNull();
    // And no summary band stands in for figures that never came.
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
  });
});
