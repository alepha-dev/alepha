/**
 * In the node project, under jsdom: `alepha/server` resolves to its server
 * build here, so the action is a real one, called in process through request
 * validation, while React renders in a DOM.
 *
 * @vitest-environment jsdom
 */
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, useClient, useInject } from "alepha/react";
import { $action, ConflictError, ValidationError } from "alepha/server";
import { AlephaServerLinks } from "alepha/server/links";
import type { ReactNode } from "react";
import { describe, expectTypeOf, it } from "vitest";

import { type FormModel, useActionForm, useFormState } from "../index.ts";

/**
 * `useActionForm` (#Q3202), in jsdom against a real action: the body is the
 * form's values, a server `ValidationError` for the body lands on its fields
 * and is not toasted when all of it landed, anything else stays the form's.
 */
const questBodySchema = z.object({
  title: z.text({ minLength: 2 }),
  email: z.email(),
});

class Api {
  public readonly calls: Array<{ body: unknown; params: unknown }> = [];

  createQuest = $action({
    path: "/projects/:projectId/quests",
    method: "POST",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: questBodySchema,
      response: z.object({ id: z.text() }),
    },
    handler: ({ body, params }) => {
      this.calls.push({ body, params });
      if (body.email === "taken@example.com") {
        throw new ValidationError({
          part: "body",
          issues: [{ path: "/email", message: "Email already in use" }],
        });
      }
      if (body.email === "partly@example.com") {
        throw new ValidationError({
          part: "body",
          issues: [
            { path: "/email", message: "Email already in use" },
            { path: "/owner", message: "No such owner" },
          ],
        });
      }
      if (body.email === "conflict@example.com") {
        throw new ConflictError("Quest already exists");
      }
      return { id: `q-${body.title}` };
    },
  });

  ping = $action({
    path: "/ping",
    method: "GET",
    schema: { response: z.text() },
    handler: () => "pong",
  });
}

/**
 * The same type as `questBodySchema`, with none of its checks: a client that
 * drifted from the server, so the server is the one to refuse.
 */
const looseBodySchema = z.object({ title: z.text(), email: z.text() });

describe("useActionForm", () => {
  const setup = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaServerLinks)
      .with(Api);
    await alepha.start();
    const errors: Array<{ error: Error; handled: boolean }> = [];
    alepha.events.on("react:action:error", (event) => {
      errors.push({ error: event.error, handled: event.handled ?? false });
    });
    return { alepha, errors, api: alepha.inject(Api) };
  };

  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  interface ProbeProps {
    projectId?: unknown;
    onForm?: (form: FormModel<typeof questBodySchema>) => void;
    onSuccess?: (response: { id: string }) => void;
  }

  const Probe = (props: ProbeProps) => {
    // The local action: under jsdom a client would resolve through the
    // registry over HTTP, and there is no server to answer it.
    const api = useInject(Api);
    const form = useActionForm(api.createQuest, {
      id: "q",
      schema: questBodySchema,
      params: { projectId: (props.projectId ?? 7) as number },
      initialValues: { title: "Quest", email: "a@example.com" },
      onSuccess: (response) => props.onSuccess?.(response),
    });
    props.onForm?.(form);
    const state = useFormState(form, ["error", "loading"]);
    return (
      <form {...form.props} data-testid="form">
        <input {...form.input.title.props} />
        <input {...form.input.email.props} />
        <span data-testid="form-error">{state.error?.message ?? ""}</span>
      </form>
    );
  };

  const typeEmail = (value: string) =>
    fireEvent.change(document.getElementById("q-email")!, {
      target: { value },
    });

  it("posts the values as the body, with the params, and hands over the response", async ({
    expect,
  }) => {
    const { alepha, api } = await setup();
    const responses: Array<{ id: string }> = [];
    const ui = mount(alepha, <Probe onSuccess={(r) => responses.push(r)} />);

    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => expect(responses).toEqual([{ id: "q-Quest" }]));
    expect(api.calls).toEqual([
      {
        body: { title: "Quest", email: "a@example.com" },
        params: { projectId: 7 },
      },
    ]);
  });

  it("lands a handler's field refusal on its field, untoasted", async ({
    expect,
  }) => {
    const { alepha, errors } = await setup();
    let model: FormModel<typeof questBodySchema> | undefined;
    const ui = mount(alepha, <Probe onForm={(f) => (model = f)} />);

    typeEmail("taken@example.com");
    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() =>
      expect(model!.errors).toEqual({ "/email": "Email already in use" }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBeInstanceOf(ValidationError);
    expect(errors[0].handled).toBe(true);
  });

  it("lands a request-validation 400 for the body on its fields", async ({
    expect,
  }) => {
    const { alepha, errors, api } = await setup();
    let model: FormModel<typeof looseBodySchema> | undefined;
    const Loose = (props: { onForm: (form: any) => void }) => {
      const api = useInject(Api);
      const form = useActionForm(api.createQuest, {
        id: "l",
        schema: looseBodySchema,
        params: { projectId: 7 },
        initialValues: { title: "x", email: "nope" },
      });
      props.onForm(form);
      return <form {...form.props} data-testid="form" />;
    };
    const ui = mount(alepha, <Loose onForm={(f) => (model = f)} />);

    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() =>
      expect(Object.keys(model!.errors).sort()).toEqual(["/email", "/title"]),
    );
    expect(api.calls).toEqual([]);
    expect(errors[0].handled).toBe(true);
  });

  it("keeps a partly mapped 400 a form-level, toasted error", async ({
    expect,
  }) => {
    const { alepha, errors } = await setup();
    let model: FormModel<typeof questBodySchema> | undefined;
    const ui = mount(alepha, <Probe onForm={(f) => (model = f)} />);

    typeEmail("partly@example.com");
    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => expect(errors).toHaveLength(1));
    expect(model!.errors).toEqual({ "/email": "Email already in use" });
    expect(errors[0].handled).toBe(false);
    expect(ui.getByTestId("form-error").textContent).not.toBe("");
  });

  it("keeps a params 400 form-level and toasted", async ({ expect }) => {
    const { alepha, errors } = await setup();
    let model: FormModel<typeof questBodySchema> | undefined;
    const ui = mount(
      alepha,
      <Probe projectId="abc" onForm={(f) => (model = f)} />,
    );

    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => expect(errors).toHaveLength(1));
    const error = errors[0].error as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.data.part).toBe("params");
    expect(errors[0].handled).toBe(false);
    expect(model!.errors).toEqual({});
  });

  it("leaves any other error to the form, as useForm does", async ({
    expect,
  }) => {
    const { alepha, errors } = await setup();
    let model: FormModel<typeof questBodySchema> | undefined;
    const ui = mount(alepha, <Probe onForm={(f) => (model = f)} />);

    typeEmail("conflict@example.com");
    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0].error).toBeInstanceOf(ConflictError);
    expect(errors[0].handled).toBe(false);
    expect(model!.errors).toEqual({});
    expect(ui.getByTestId("form-error").textContent).toBe(
      "Quest already exists",
    );
  });

  it("refuses a schema that is not the action's body, and an action with no body", () => {
    const Typed = () => {
      const api = useClient<Api>();
      useActionForm(api.createQuest, {
        // @ts-expect-error a field the body does not have
        schema: z.object({
          title: z.text(),
          email: z.email(),
          extra: z.text(),
        }),
        params: { projectId: 1 },
      });
      useActionForm(api.ping, {
        // @ts-expect-error `ping` takes no body
        schema: z.object({ title: z.text() }),
      });
      const form = useActionForm(api.createQuest, {
        schema: questBodySchema,
        params: { projectId: 1 },
        onSuccess: (response) => {
          expectTypeOf(response).toEqualTypeOf<{ id: string }>();
        },
      });
      expectTypeOf(form).toEqualTypeOf<FormModel<typeof questBodySchema>>();
      return null;
    };
    void Typed;
  });
});
