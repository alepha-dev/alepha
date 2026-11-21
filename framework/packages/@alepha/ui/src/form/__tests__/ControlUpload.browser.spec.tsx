import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Control } from "../Control.tsx";

/**
 * `ControlUpload` keeps the form in step with what the server stored, lets a
 * required single file be replaced, and gives back the object URLs it makes
 * for image previews.
 *
 * The upload endpoint is answered in process: the client is the only thing
 * substituted, and every case reads what the control wrote into the form.
 */
describe("ControlUpload", () => {
  /** Names of the files the fake endpoint refuses. */
  let refuse: Set<string>;
  let uploaded: string[];
  let written: unknown;
  let created: string[];
  let revoked: string[];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  class UploadLinks extends LinkProvider {
    public override client(): any {
      return {
        uploadFile: async ({ body }: { body: { file: File } }) => {
          if (refuse.has(body.file.name)) throw new Error("refused");
          const id = `id-${body.file.name}`;
          uploaded.push(id);
          return { id, name: body.file.name, mimeType: body.file.type };
        },
      };
    }
  }

  beforeEach(() => {
    refuse = new Set();
    uploaded = [];
    written = undefined;
    created = [];
    revoked = [];
    // jsdom has no object URLs: these two stand in, and record.
    URL.createObjectURL = () => {
      const url = `blob:test/${created.length}`;
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  const Probe = (props: { multi?: boolean; initial?: string }) => {
    const form = useForm({
      schema: z.object({
        one: z.uuid(),
        many: z.array(z.string()).optional(),
      }),
      initialValues: props.initial ? { one: props.initial } : undefined,
      handler: () => {},
      onChange: (_key, value) => {
        written = value;
      },
    });
    return props.multi ? (
      <Control input={form.input.many} label="Files" upload={{ multi: true }} />
    ) : (
      <Control input={form.input.one} label="File" upload />
    );
  };

  const mount = async (props: { multi?: boolean; initial?: string } = {}) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReactI18n)
      .with({ provide: LinkProvider, use: UploadLinks });
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <Probe {...props} />
      </AlephaContext.Provider>,
    );
  };

  const fileInput = () =>
    document.querySelector('input[type="file"]') as HTMLInputElement;

  const pick = (...files: File[]) =>
    fireEvent.change(fileInput(), { target: { files } });

  const image = (name: string) => new File(["x"], name, { type: "image/png" });

  it("keeps the files that uploaded when a later one fails", async () => {
    await mount({ multi: true });
    refuse.add("c.png");

    pick(image("a.png"), image("b.png"), image("c.png"));

    await waitFor(() => expect(uploaded).toEqual(["id-a.png", "id-b.png"]));
    await waitFor(() => expect(written).toEqual(["id-a.png", "id-b.png"]));
  });

  it("offers to replace the file a required single upload holds", async () => {
    const ui = await mount({ initial: "id-old.png" });

    // Required, so no remove cross: the choose button is the only way to
    // put another file in.
    expect(ui.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(ui.getByRole("button", { name: "Choose a file" })).toBeTruthy();

    pick(image("new.png"));
    await waitFor(() => expect(written).toBe("id-new.png"));
  });

  it("revokes the preview of a file the field no longer holds", async () => {
    await mount({ initial: "id-old.png" });

    pick(image("first.png"));
    await waitFor(() => expect(written).toBe("id-first.png"));
    expect(created).toEqual(["blob:test/0"]);

    pick(image("second.png"));
    await waitFor(() => expect(written).toBe("id-second.png"));
    await waitFor(() => expect(revoked).toEqual(["blob:test/0"]));
  });

  it("revokes every preview it made on unmount", async () => {
    const ui = await mount({ multi: true });

    pick(image("a.png"), image("b.png"));
    await waitFor(() => expect(written).toEqual(["id-a.png", "id-b.png"]));
    expect(revoked).toEqual([]);

    ui.unmount();
    expect(revoked.sort()).toEqual(["blob:test/0", "blob:test/1"]);
  });
});
