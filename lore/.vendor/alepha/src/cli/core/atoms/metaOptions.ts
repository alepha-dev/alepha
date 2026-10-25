import { $atom, type Infer, z } from "alepha";

/**
 * Build metadata an app declares for itself, overriding what the build resolves.
 *
 * Everything here is optional and empty by default: an app that says nothing
 * gets the git tag, the commit SHA and its directory name, which is the right
 * answer for most apps.
 *
 * ⚠️ This is the BUILD-time half, and it is not interchangeable with the
 * `/version` route's `versionOptions`. These values are baked into the client
 * bundle at compile time, so a runtime atom could not supply them: by the time
 * the app is running, the bundle already contains whatever it contains.
 */
export const metaOptions = $atom({
  name: "alepha.cli.meta.options",
  description: "Build metadata overrides",
  schema: z.object({
    /**
     * Publish this instead of the git tag on the built commit.
     *
     * The reason to set it: tags are created per release, so an app that
     * deploys on every push to main resolves to `"latest"` on everything that
     * is not a release. An app that would rather publish a number of its own
     * (its `package.json` version, or the framework's) declares it here.
     */
    version: z.text().optional(),

    /**
     * Publish this instead of the slugified directory name.
     */
    name: z.text().optional(),

    /**
     * Publish this instead of `git rev-parse --short HEAD`.
     *
     * Rarely needed. The case it covers is a build with no `.git` at all - a
     * docker context or a tarball - where CI knows the SHA and the build does
     * not.
     */
    commit: z.text().optional(),
  }),
  default: {},
  serverOnly: true,
});

export type MetaOptions = Infer<typeof metaOptions.schema>;
