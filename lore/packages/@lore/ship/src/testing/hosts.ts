import { createTestProject } from "@lore/core/testing";
import type { Alepha } from "alepha";
import type { UserAccountToken } from "alepha/security";

import { HostController } from "../api/controllers/HostController.ts";
import { ProjectHostController } from "../api/controllers/ProjectHostController.ts";
import type { CreateHostBody } from "../api/schemas/createHostBodySchema.ts";
import type { OwnedHostResource } from "../api/schemas/ownedHostResourceSchema.ts";

/**
 * A host created the one way a host comes to exist (#E126): inside a
 * project, its home, through `createProjectHost`, which lends it there too.
 * Without `projectId` a project owned by `user` is created for it, so the
 * caller manages the host as that project's owner.
 *
 * Returns the host as `getHost` answers it to `user`, plus the secret a
 * bay create hands back once.
 */
export const createTestHost = async (
  alepha: Alepha,
  user: UserAccountToken,
  body: CreateHostBody,
  options: { projectId?: number } = {},
): Promise<OwnedHostResource & { secret?: string; projectId: number }> => {
  const projectId =
    options.projectId ??
    (await createTestProject(alepha, { createdBy: user.id })).id;
  const minted = await alepha
    .inject(ProjectHostController)
    .createProjectHost({ params: { projectId }, body }, { user });
  const host = await alepha
    .inject(HostController)
    .getHost({ params: { hostId: minted.id } }, { user });
  return {
    ...host,
    ...(minted.secret ? { secret: minted.secret } : {}),
    projectId,
  };
};
