import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError } from "alepha/server";

import { AppController } from "../../api/controllers/AppController.ts";
import { SigilController } from "../../api/controllers/SigilController.ts";
import {
  sigilCreateParamsSchema,
  sigilCreateResultSchema,
  sigilDeleteParamsSchema,
  sigilDeleteResultSchema,
  sigilListParamsSchema,
  sigilListResultSchema,
  sigilRotateParamsSchema,
  sigilRotateResultSchema,
} from "../schemas/index.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * MCP tools for sigils — the credential ONE DEPLOYED COPY reports with.
 *
 * ⚠️ **A sigil is no longer an app.** Since Apps v3 the app instance
 * (`app_instance_*`) is the identity - `(app, env)`, both required - and a
 * sigil is an optional unlock on one of those: it turns Analytics, Vitals,
 * Errors and Explore on for that copy. An instance without one is not broken,
 * it is a copy nobody wired telemetry into.
 *
 * These tools keep their names on purpose, because an MCP tool that disappears
 * is a silent failure in whatever script or saved instruction was calling it.
 * They are deprecated in favour of the `app_instance_*` family for everything
 * except minting, which is what `sigil_create` still does.
 *
 * Listing and reading are open to any project member; creating, rotating and
 * deleting are owner-only, and that is enforced in `SigilController` rather
 * than restated here.
 */
export class SigilTools {
  protected readonly sigils = $inject(SigilController);
  protected readonly apps = $inject(AppController);
  protected readonly projects = $inject(ProjectTools);

  sigil_list = $tool({
    title: "List sigils",
    description:
      'Every credential in the project, each with the deployed copy it belongs to (`app`, `env`) and when it last reported. `lastSeenAt` absent means that copy has never sent anything, which distinguishes a quiet one from one that was never wired up. `name` is a DERIVED label, `"<app>/<env>"`, written by the server. The token is not returned and cannot be: only its prefix is stored in readable form. ⚠️ This lists CREDENTIALS, so a copy with no sigil does not appear — `app_instance_list` is the inventory.',
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: sigilListParamsSchema,
      result: sigilListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      // Two reads rather than a join: the instance is where `app` and `env`
      // live, and a sigil row carries only the mirror of them. Concurrent, so
      // the client folds them into one batch.
      const [res, instances] = await Promise.all([
        this.sigils.listSigils({ params: { projectId } }),
        this.apps.listApps({ params: { projectId } }),
      ]);
      const byId = new Map(
        instances.items.flatMap((instance) =>
          instance.sigilId ? [[instance.sigilId, instance] as const] : [],
        ),
      );
      return {
        sigils: res.items.flatMap((sigil) => {
          const instance = byId.get(sigil.id);
          // ⚠️ A sigil no instance points at is unreachable from every page and
          // should not exist: `AppService.createSigil` deletes one rather than
          // leave it behind. Skipping it here rather than inventing a pair
          // keeps this list honest about what an agent can act on.
          return instance
            ? [{ ...sigil, app: instance.app, env: instance.env }]
            : [];
        }),
      };
    },
  });

  sigil_create = $tool({
    title: "Create a sigil",
    description:
      "Mint the key one deployed copy reports with, creating the copy first if it does not exist yet. Project owner only. Pass `app` and, for anything but production, `env`. ⚠️ One sigil per copy: a second would split that copy's history in two and make every aggregate wrong, so a copy that already has one is refused — use `sigil_rotate` to replace the credential. ⚠️ The returned `token` is the only cleartext copy that will ever exist: it is stored hashed, so nothing can show it again. Hand it to whoever configures the app and do not echo it into a folio, a quest or a commit. `name` is a deprecated alias of `app`.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: sigilCreateParamsSchema,
      result: sigilCreateResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      // `name` is the deprecated alias, kept so saved instructions keep
      // working. One of the two has to be there; the schema cannot say "either"
      // without making both optional and the message unreadable, so the refusal
      // is here and names the field to pass.
      const app = params.app ?? params.name;
      if (!app) {
        throw new BadRequestError("Pass `app`: which app to mint for.");
      }
      // ⚠️ `production` is the one place a default is safe. This tool creates
      // the instance when it is missing, so the default NAMES a copy rather
      // than guessing among several that already exist - which is exactly why
      // `app_instance_create` refuses to default it.
      const env = params.env ?? "production";

      // ⚠️ The one MCP tool that composes two calls, and it has to: a
      // credential hangs off a deployed copy, and `createSigil` is 404 without
      // one. Composed here rather than inside the controller, so there is
      // exactly one endpoint that creates instances and the composition is
      // visible where it happens.
      const existing = await this.apps
        .getApp({ params: { projectId, app, env } })
        .catch(() => undefined);
      if (!existing) {
        await this.apps.createApp({
          params: { projectId },
          body: { app, env },
        });
      }

      const minted = await this.sigils.createSigil({
        params: { projectId },
        body: { app, env },
      });
      return { ...minted, app, env };
    },
  });

  sigil_rotate = $tool({
    title: "Rotate a sigil's token",
    description:
      "Revoke a sigil's token and mint a replacement, keeping the sigil and everything it has ever reported. Project owner only. This is the right answer to a leaked token: the old one stops working the instant the hash changes, while views, vitals, unique visitors and the app's error budget all survive. Prefer it to `sigil_delete`, which throws that history away. ⚠️ The new `token` is shown once — the app must be updated with it or it stops reporting.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: sigilRotateParamsSchema,
      result: sigilRotateResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const rotated = await this.sigils.rotateSigil({
        params: { projectId, sigilId: params.id },
      });
      // The pair the credential belongs to, which the sigil row carries only as
      // a mirror. Split rather than joined: `/` cannot appear in either half,
      // so the mirror's separator is unambiguous.
      const [app = rotated.name, env = ""] = rotated.name.split("/");
      return { ...rotated, app, env };
    },
  });

  sigil_delete = $tool({
    title: "Delete a sigil",
    description:
      "Remove a credential and everything it reported. Project owner only. ⚠️ DESTRUCTIVE: the four aggregate tables cascade, so this erases that copy's page views, web vitals, unique visitors and error budget. Cannot be undone; if the goal is only to invalidate a leaked token, use `sigil_rotate`. Blights already filed survive - a triage decision outlives the credential that surfaced it. ⚠️ **The deployed copy SURVIVES**, with no sigil: this used to remove the app, and since Apps v3 it does not. `app_instance_delete` is the tool that removes the copy.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    schema: {
      params: sigilDeleteParamsSchema,
      result: sigilDeleteResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const res = await this.sigils.deleteSigil({
        params: { projectId, sigilId: params.id },
      });
      return { ok: res.ok };
    },
  });
}
