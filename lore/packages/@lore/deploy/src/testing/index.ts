/**
 * Deploy's spec helpers (#E75, #Q2614): the in-memory Cloudflare probe and
 * registry transport, the artifact tarball builders, and the pages a route
 * loads lazily for the specs that render them. Nothing at runtime imports
 * `./testing`.
 *
 * @module
 */
export {
  packedArtifact,
  type TarEntry,
  gzip,
  tar,
  zstd,
} from "./artifactTarball.ts";
export { DeployTestEntities } from "./entities.ts";
export { MemoryCloudflareProbeService } from "./MemoryCloudflareProbeService.ts";
export {
  childManifest,
  dockerManifestList,
  MemoryRegistryTransport,
  ociIndex,
  type RegistryAnswer,
} from "./MemoryRegistryTransport.ts";

export { default as ProjectArtifacts } from "../web/app/components/project/artifacts/ProjectArtifacts.tsx";

// Core's helpers, for a Deploy spec that needs a project or a member.
export {
  createTestMember,
  createTestMemberByProjectId,
  createTestProject,
} from "@lore/core/testing";
