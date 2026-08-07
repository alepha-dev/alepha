import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
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
 * MCP tools for sigils — the credentials applications report with.
 *
 * A **sigil is one app**: a name, unique within the project, and the token that
 * name reports with. How finely an operator slices their world is their call —
 * an app that wants staging kept apart from production enrols two sigils.
 *
 * These exist so enrolling an app is something an agent can do while it is
 * already in the code that needs enrolling. Listing and reading are open to any
 * project member; creating, rotating and deleting are owner-only, and that is
 * enforced in `SigilController` rather than restated here.
 */
export class SigilTools {
  protected readonly sigils = $inject(SigilController);
  protected readonly projects = $inject(ProjectTools);

  sigil_list = $tool({
    title: "List sigils",
    description:
      "List a project's sigils — which apps are enrolled to report here, and when each last reported. `lastSeenAt` absent means that app has never sent anything, which distinguishes a quiet app from one that was never wired up. The token is not returned and cannot be: only its prefix is stored in readable form.",
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
      const res = await this.sigils.listSigils({ params: { projectId } });
      return { sigils: res.items };
    },
  });

  sigil_create = $tool({
    title: "Create a sigil",
    description:
      "Enroll an app and mint its token. Project owner only. `name` is the identity, and it is a slug rather than a title: lowercase letters, digits and interior hyphens only, 64 characters at most — `lore-staging`, not `Lore Staging`, which is refused. It is also the app's URL segment. One sigil per name within a project, and a repeat is rejected rather than silently splitting that app's history across two credentials. ⚠️ The returned `token` is the only cleartext copy that will ever exist: it is stored hashed, so nothing can show it again. Hand it to whoever configures the app and do not echo it into a folio, a quest or a commit.",
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
      return await this.sigils.createSigil({
        params: { projectId },
        body: { name: params.name },
      });
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
      return await this.sigils.rotateSigil({
        params: { projectId, sigilId: params.id },
      });
    },
  });

  sigil_delete = $tool({
    title: "Delete a sigil",
    description:
      "Remove an app entirely. Project owner only. ⚠️ DESTRUCTIVE: the four aggregate tables cascade, so this erases that app's page views, web vitals, unique visitors and error budget along with the credential. Cannot be undone. If the goal is only to invalidate a leaked token, use `sigil_rotate` instead. Blights already filed survive — a triage decision outlives the credential that surfaced it.",
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
