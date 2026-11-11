import { createTestProject } from "@lore/core/testing";
import type { Alepha } from "alepha";
import type { UserAccountToken } from "alepha/security";

import { EstateController } from "../api/controllers/EstateController.ts";
import { ProjectEstateController } from "../api/controllers/ProjectEstateController.ts";
import type { CreateEstateBody } from "../api/schemas/createEstateBodySchema.ts";
import type { OwnedEstateResource } from "../api/schemas/ownedEstateResourceSchema.ts";

/**
 * An estate created the one way an estate comes to exist (#E126): inside a
 * project, its home, through `createProjectEstate`, which lends it there too.
 * Without `projectId` a project owned by `user` is created for it, so the
 * caller manages the estate as that project's owner.
 *
 * Returns the estate as `getEstate` answers it to `user`, plus the secret a
 * bay create hands back once.
 */
export const createTestEstate = async (
  alepha: Alepha,
  user: UserAccountToken,
  body: CreateEstateBody,
  options: { projectId?: number } = {},
): Promise<OwnedEstateResource & { secret?: string; projectId: number }> => {
  const projectId =
    options.projectId ??
    (await createTestProject(alepha, { createdBy: user.id })).id;
  const minted = await alepha
    .inject(ProjectEstateController)
    .createProjectEstate({ params: { projectId }, body }, { user });
  const estate = await alepha
    .inject(EstateController)
    .getEstate({ params: { estateId: minted.id } }, { user });
  return {
    ...estate,
    ...(minted.secret ? { secret: minted.secret } : {}),
    projectId,
  };
};
