import { type Infer, z } from "alepha";

import { devActionMetadataSchema } from "./DevActionMetadata.ts";
import { devAtomMetadataSchema } from "./DevAtomMetadata.ts";
import { devCacheMetadataSchema } from "./DevCacheMetadata.ts";
import { devEntityMetadataSchema } from "./DevEntityMetadata.ts";
import { devEnvMetadataSchema } from "./DevEnvMetadata.ts";
import { devJobMetadataSchema } from "./DevJobMetadata.ts";
import { devModuleMetadataSchema } from "./DevModuleMetadata.ts";
import { devPageMetadataSchema } from "./DevPageMetadata.ts";
import { devPermissionMetadataSchema } from "./DevPermissionMetadata.ts";
import { devProviderMetadataSchema } from "./DevProviderMetadata.ts";
import { devRealmMetadataSchema } from "./DevRealmMetadata.ts";
import { devRoleMetadataSchema } from "./DevRoleMetadata.ts";
import { devStorageMetadataSchema } from "./DevStorageMetadata.ts";
import { devTopicMetadataSchema } from "./DevTopicMetadata.ts";

export const devSystemSchema = z.object({
  /**
   * The application's own version, from its `package.json`.
   *
   * This used to be called `alephaVersion`, which is what it never was: the
   * value has always come from the app's `npm_package_version`. No view read
   * it, so nothing displayed the wrong number - it was just wrong in the
   * payload.
   */
  appVersion: z.text(),
  /**
   * The framework's version, read from the `alepha` package itself.
   */
  alephaVersion: z.text(),
  nodeVersion: z.text(),
  runtime: z.enum(["node", "bun"]),
  mode: z.enum(["development", "production"]),
  port: z.integer(),
  uptime: z.number(),
  memoryUsage: z.number(),
});

export type DevSystem = Infer<typeof devSystemSchema>;

export const devMetadataSchema = z.object({
  system: devSystemSchema,
  actions: z.array(devActionMetadataSchema),
  jobs: z.array(devJobMetadataSchema),
  topics: z.array(devTopicMetadataSchema),
  storages: z.array(devStorageMetadataSchema),
  realms: z.array(devRealmMetadataSchema),
  roles: z.array(devRoleMetadataSchema),
  permissions: z.array(devPermissionMetadataSchema),
  caches: z.array(devCacheMetadataSchema),
  pages: z.array(devPageMetadataSchema),
  providers: z.array(devProviderMetadataSchema),
  modules: z.array(devModuleMetadataSchema),
  entities: z.array(devEntityMetadataSchema),
  envs: z.array(devEnvMetadataSchema),
  atoms: z.array(devAtomMetadataSchema),
});

export type DevMetadata = Infer<typeof devMetadataSchema>;
