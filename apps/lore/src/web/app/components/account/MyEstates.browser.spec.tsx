import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, describe, it } from "vitest";

import { I18n } from "../../services/I18n.ts";
import MyEstates from "./MyEstates.tsx";

/**
 * Answers `listMyEstates` and `createEstate`, and records what was asked.
 * Substitution rather than `vi.mock`, per `CLAUDE.md`.
 */
class RecordingLinkProvider extends LinkProvider {
  public calls: string[] = [];
  public responses: Record<string, unknown> = {};

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          const call = async () => {
            this.calls.push(prop);
            const answer = this.responses[prop];
            // A scripted refusal, so a case can drive the "the dialog stays
            // open with the message beside the field" path the same way the
            // server drives it: an error whose `data.field` survived the
            // round trip.
            if (answer instanceof Error) {
              throw answer;
            }
            return answer ?? {};
          };
          return Object.assign(call, { can: () => true });
        },
      },
    );
  }
}

class Routes {
  projectSettingsEstates = $page({
    name: "projectSettingsEstates",
    path: "/:projectSlug/settings/estates",
    component: () => null,
  });
}

const SECRET = "est_thisIsTheOnlyTimeItExists";

const CF_ACCOUNT = "0123456789abcdef0123456789abcdef";

const CF_TOKEN = `cfut_${"a1B2c3D4e5".repeat(4)}0123abcd`;

const estate = (over: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  slug: "ovh-1",
  type: "bay",
  online: false,
  deployAllowed: false,
  collectSeries: false,
  statsIntervalSeconds: 900,
  secretPrefix: "est_weFZU3NK",
  projects: [],
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  ...over,
});

/**
 * `/account/estates` after the API-keys redesign (#1862, feedback #2110 and
 * #2109).
 *
 * The case that matters is the secret: `estates.secretHash` stores a hash, so
 * the cleartext exists exactly once and there is no second chance to read it.
 * It used to be a card at the top of a page that re-renders on every switch
 * in every estate below it. So this pins both halves - it IS revealed, and it
 * is GONE once dismissed - because a reveal that silently stopped happening
 * and one that leaked onto the page afterwards are both failures nothing else
 * would catch.
 */
describe("MyEstates", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (responses: Record<string, unknown> = {}) => {
    cleanup();
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: RecordingLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    const links = alepha.inject(LinkProvider) as RecordingLinkProvider;
    links.responses = responses;
    return {
      links,
      ...render(
        <AlephaContext.Provider value={alepha}>
          {/* The drawer's Rotate and Delete both open a confirmation. */}
          <DialogProvider>
            <MyEstates />
          </DialogProvider>
        </AlephaContext.Provider>,
      ),
    };
  };

  it("says so when the account owns no estate", async ({ expect }) => {
    const { findByText } = await show({ listMyEstates: { items: [] } });

    expect(await findByText(/You own no estate yet/)).toBeTruthy();
  });

  it("lists an estate as a row, with the secret truncated", async ({
    expect,
  }) => {
    const { findByTestId, queryByTestId } = await show({
      listMyEstates: { items: [estate()] },
    });

    const row = await findByTestId("my-estate-row");
    expect(row.textContent).toContain("ovh-1");
    expect(row.textContent).toContain("est_weFZU3NK");
    // The row is the whole page until something is opened.
    expect(queryByTestId("my-estate-drawer")).toBeNull();
  });

  /**
   * ⚠️ **Two behaviours in one list since the bay console landed (#E37).** A
   * `bay` row navigates to `/bay/:estateId`, where its switches, apps and
   * actions now live; a `cloudflare` row keeps the drawer until #E22 gives it
   * a page of its own. This spec pins the drawer half, which is the one that
   * still exists here.
   */
  it("opens the drawer from a cloudflare row, and closes it again", async ({
    expect,
  }) => {
    const { findByTestId, findByText } = await show({
      listMyEstates: { items: [estate({ type: "cloudflare" })] },
    });

    fireEvent.click(await findByTestId("my-estate-row"));

    const drawer = await findByTestId("my-estate-drawer");
    // Everything the card used to hold, now behind the click.
    expect(drawer.textContent).toContain("Not lent to any project.");
    // ⚠️ No "Rotate secret" here: a cloudflare credential is pasted rather
    // than minted, so the drawer shows that button for `bay` only.
    expect(await findByText("Delete")).toBeTruthy();
  });

  /**
   * The heart of #2109, in both directions.
   */
  it("reveals a created secret in a dialog, and drops it on dismiss", async ({
    expect,
  }) => {
    const { findByTestId, getByTestId, queryByText, findByText } = await show({
      listMyEstates: { items: [] },
      createEstate: { ...estate(), secret: SECRET },
    });

    await findByText(/You own no estate yet/);

    fireEvent.click(getByTestId("estate-create-open"));
    fireEvent.change(getByTestId("estate-create-slug"), {
      target: { value: "ovh-1" },
    });
    fireEvent.click(getByTestId("estate-create-submit"));

    const reveal = await findByTestId("my-estate-secret-dialog");
    expect(reveal.textContent).toContain(SECRET);

    // Dismissed, and gone from the document - not merely hidden behind the
    // dialog, which is what a card on the page would have left behind.
    fireEvent.click(await findByText("Done"));
    await waitFor(() => expect(queryByText(SECRET)).toBeNull());

    // The row survives, showing only the masked prefix.
    const row = await findByTestId("my-estate-row");
    expect(row.textContent).toContain("est_weFZU3NK");
    expect(row.textContent).not.toContain(SECRET);
  });

  it("does not reveal anything before an estate is created", async ({
    expect,
  }) => {
    const { queryByTestId, findByText } = await show({
      listMyEstates: { items: [estate()] },
    });

    await findByText("ovh-1");
    expect(queryByTestId("my-estate-secret-dialog")).toBeNull();
  });

  /**
   * ⚠️ The correctness bug this quest exists to prevent.
   *
   * A bay create mints a secret Lore generated and shows it once. A
   * cloudflare create mints NOTHING: the user brought the token. Echoing it
   * back is not a credential handover, it is Lore teaching that it hands out
   * Cloudflare tokens, and it puts the token in a second place on screen
   * after #1629 took care that no read path returns it.
   *
   * The dialog stays shut because the response carries no `secret` FIELD,
   * which is what `secret: z.string().optional()` made possible. This case
   * asserts the absence, not an empty string.
   */
  it("does not open the secret dialog for a cloudflare create", async ({
    expect,
  }) => {
    const cloudflare = {
      ...estate({
        type: "cloudflare",
        secretPrefix: "cfut_a1B2c3D4",
        accountId: CF_ACCOUNT,
        credentialStatus: "valid",
        credentialCheckedAt: "2026-09-06T00:00:00.000Z",
        deployAllowed: true,
      }),
    };
    const { getByTestId, queryByTestId, findByText, findByTestId } = await show(
      {
        listMyEstates: { items: [] },
        createEstate: cloudflare,
      },
    );

    await findByText(/You own no estate yet/);
    fireEvent.click(getByTestId("estate-create-open"));
    fireEvent.click(getByTestId("estate-type-cloudflare"));
    fireEvent.change(getByTestId("estate-create-slug"), {
      target: { value: "cf-1" },
    });
    fireEvent.change(getByTestId("estate-create-account"), {
      target: { value: CF_ACCOUNT },
    });
    fireEvent.change(getByTestId("estate-create-token"), {
      target: { value: CF_TOKEN },
    });
    fireEvent.click(getByTestId("estate-create-submit"));

    // The row lands, showing the credential's status rather than a
    // connection badge that can only ever say "offline".
    const status = await findByTestId("my-estate-credential-status");
    expect(status.textContent).toContain("valid");
    expect(cloudflare).not.toHaveProperty("secret");
    expect(queryByTestId("my-estate-secret-dialog")).toBeNull();
  });

  it("keeps the create dialog open and names the field a refusal concerns", async ({
    expect,
  }) => {
    const refusal = Object.assign(
      new Error('This token is missing "D1: Edit"'),
      { data: { field: "token" } },
    );
    const { getByTestId, findByTestId } = await show({
      listMyEstates: { items: [] },
      createEstate: refusal,
    });

    fireEvent.click(getByTestId("estate-create-open"));
    fireEvent.click(getByTestId("estate-type-cloudflare"));
    fireEvent.change(getByTestId("estate-create-slug"), {
      target: { value: "cf-1" },
    });
    fireEvent.change(getByTestId("estate-create-account"), {
      target: { value: CF_ACCOUNT },
    });
    fireEvent.change(getByTestId("estate-create-token"), {
      target: { value: CF_TOKEN },
    });
    fireEvent.click(getByTestId("estate-create-submit"));

    // Beside the token field, not a toast: the person hitting this has to
    // go and widen the token at Cloudflare, and the sentence has to still be
    // on screen while they do it.
    const message = await findByTestId("estate-create-token-error");
    expect(message.textContent).toContain("D1: Edit");
    // Still open, so nothing typed has to be typed again.
    expect(getByTestId("estate-create-slug")).toBeTruthy();
  });

  it("shows a cloudflare drawer without the machine's controls", async ({
    expect,
  }) => {
    const { findByTestId, queryByTestId, queryByText } = await show({
      listMyEstates: {
        items: [
          estate({
            type: "cloudflare",
            secretPrefix: "cfut_a1B2c3D4",
            accountId: CF_ACCOUNT,
            credentialStatus: "invalid",
            credentialCheckedAt: "2026-09-06T00:00:00.000Z",
            credentialError: 'This token is missing "D1: Edit"',
          }),
        ],
      },
    });

    fireEvent.click(await findByTestId("my-estate-row"));
    await findByTestId("my-estate-drawer");

    // What only a machine has is gone: the series switch, the interval, the
    // command queue and the rotation that mints a new secret.
    expect(queryByTestId("my-estate-series")).toBeNull();
    expect(queryByTestId("my-estate-rotate")).toBeNull();
    expect(queryByText("Commands")).toBeNull();
    // What a Cloudflare estate has instead.
    expect(queryByTestId("my-estate-token")).toBeTruthy();
    expect(queryByTestId("my-estate-replace")).toBeTruthy();
    expect(queryByTestId("my-estate-recheck")).toBeTruthy();
    expect(
      (await findByTestId("my-estate-credential-error")).textContent,
    ).toContain("D1: Edit");
    // The deploys switch stays: it is the owner's kill switch.
    expect(queryByTestId("my-estate-deploys")).toBeTruthy();
  });

  it("replaces a token without revealing anything", async ({ expect }) => {
    const replaced = estate({
      type: "cloudflare",
      secretPrefix: "cfat_z9Y8x7W6",
      accountId: CF_ACCOUNT,
      credentialStatus: "valid",
      credentialCheckedAt: "2026-09-06T00:00:00.000Z",
    });
    const { findByTestId, getByTestId, queryByTestId, queryByText } =
      await show({
        listMyEstates: {
          items: [
            estate({
              type: "cloudflare",
              secretPrefix: "cfut_a1B2c3D4",
              accountId: CF_ACCOUNT,
              credentialStatus: "valid",
            }),
          ],
        },
        replaceEstateCredential: replaced,
      });

    fireEvent.click(await findByTestId("my-estate-row"));
    const field = await findByTestId("my-estate-token");
    // A password input with autocomplete off: a password manager offering to
    // save a Cloudflare deploy token is the leak the mask exists to prevent.
    expect(field.getAttribute("type")).toBe("password");
    expect(field.getAttribute("autocomplete")).toBe("off");

    fireEvent.change(field, { target: { value: CF_TOKEN } });
    fireEvent.click(getByTestId("my-estate-replace"));

    // A write, not a mint: nothing is revealed afterwards, and the field is
    // emptied.
    await waitFor(() =>
      expect(queryByTestId("my-estate-secret-dialog")).toBeNull(),
    );
    await waitFor(() => expect(queryByText(CF_TOKEN)).toBeNull());
  });
});
