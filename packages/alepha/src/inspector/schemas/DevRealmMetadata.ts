import { type Infer, z } from "alepha";

export const devRealmMetadataSchema = z.object({
  name: z.text(),
  description: z.text().optional(),
  roles: z.array(z.any()).optional(),
  type: z.enum(["internal", "external"]),
  settings: z
    .object({
      accessTokenExpiration: z.any().optional(),
      refreshTokenExpiration: z.any().optional(),
      hasOnCreateSession: z.boolean(),
      hasOnRefreshSession: z.boolean(),
      hasOnDeleteSession: z.boolean(),
    })
    .optional(),
});

export type DevRealmMetadata = Infer<typeof devRealmMetadataSchema>;
