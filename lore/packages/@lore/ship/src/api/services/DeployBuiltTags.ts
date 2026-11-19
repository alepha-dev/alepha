import { BuiltTagRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { artifacts } from "../entities/artifacts.ts";

/**
 * Ship's answer to core's {@link BuiltTagRegistry}: the tag and commit of
 * every artifact a project pushed, which Build's Quality report reads to mark
 * tags on its coverage curve (#E162). Listed, since nothing injects it.
 */
export class DeployBuiltTags {
  protected readonly registry = $inject(BuiltTagRegistry);
  protected readonly artifacts = $repository(artifacts);

  constructor() {
    this.registry.register((projectId) =>
      this.artifacts.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["tag", "commitSha"],
      }),
    );
  }
}
