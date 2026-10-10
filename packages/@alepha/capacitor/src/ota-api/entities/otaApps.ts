import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * One native app that receives live updates, by its bundle identifier: a
 * variant is an app of its own (`dev.alepha.mobile.acme`), so identities
 * never cross.
 *
 * The app's publisher public key is stored here, never the private half:
 * the server opens and inspects every upload with it, and refuses a bundle
 * sealed with any other key.
 */
export const otaApps = $entity({
  name: "ota_apps",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    /**
     * The native bundle identifier devices send as `app_id`.
     */
    appId: z.text(),

    name: z.text({ maxLength: 100 }),

    /**
     * The publisher's RSA public key, PKCS#1 PEM: the `publicKey` the
     * native config carries.
     */
    publicKey: z.text({ size: "long" }),

    /**
     * The plugin's identity of {@link publicKey}: its first 20 base64
     * characters.
     */
    keyId: z.text({ maxLength: 64 }),

    /**
     * The channel devices follow unless an operator or an allowed
     * self-assignment says otherwise.
     */
    defaultChannel: db.default(z.text({ maxLength: 64 }), "production"),

    /**
     * The API keys (`alepha/api/keys` ids) allowed to publish to this app,
     * on top of their `ota:release` permission. A key with the permission
     * and not listed here is refused.
     */
    publisherKeyIds: db.default(z.array(z.uuid()), []),
  }),
  indexes: [{ columns: ["appId"], unique: true }],
});

export type OtaAppEntity = Infer<typeof otaApps.schema>;
