import { projects } from "@lore/core/schemas";
import { $hook } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { type AppInstance, appInstances } from "../entities/appInstances.ts";
import { type Host, hosts } from "../entities/hosts.ts";

/**
 * The name a deployed copy carries in its host, decided on its first deploy
 * and read back on every one after (`appInstances.resourceName`).
 *
 * One owner for both deploy paths: a Cloudflare deploy (`DeployService`) names
 * its Worker, D1, R2, KV and queue with it, and a Bay deploy
 * (`HostCommandController`) sends the project segment Bay composes its
 * instance key, directory and default subdomain from. Both need the same three
 * rules, so they live here once.
 *
 * ## ⚠️ Why the project is in the name at all
 *
 * With the app alone, two Lore projects that each call an app `api` and deploy
 * `production` onto one host compute one name: one Worker, one database, one
 * Bay directory, silently shared, each deploy overwriting the other.
 *
 * ## ⚠️ Why it is stored rather than recomputed
 *
 * The project's slug moves when the project is renamed, and neither Cloudflare
 * nor a Bay machine renames anything: a recomputed name is an empty database
 * or an empty instance beside the live one. Stored, a rename moves nothing.
 */
export class ResourceNameService {
  protected readonly instances = $repository(appInstances);
  protected readonly hosts = $repository(hosts);
  protected readonly projects = $repository(projects);

  /**
   * The copy's name: the stored one, or a fresh one stored now.
   *
   * ⚠️ **Stored BEFORE the deploy, not after it.** A deploy that fails halfway
   * may already have created the database or the instance under this name.
   * Written first, the retry comes back to it even if the project was renamed
   * in between; written after success, it would not.
   */
  public async resolve(instance: AppInstance, host: Host): Promise<string> {
    const name = instance.resourceName ?? (await this.derive(instance, host));
    await this.assertFree(instance, host, name);
    if (!instance.resourceName) {
      await this.instances.updateById(instance.id, { resourceName: name });
    }
    return name;
  }

  /**
   * A Bay deploy that came back `done` vouches for its copy: it now runs as
   * its name on that host (`resourceHostId`), which is what lets its
   * Backups tab drive the instance.
   *
   * ⚠️ **On success, never when queued.** A deploy refused, failed or timed
   * out never replaced what ran under that name, which may be another
   * project's instance (a copy moved away and still running there): vouching
   * at queue time handed its backups and restores to whoever clicked deploy.
   */
  protected readonly onCommandProgressed = $hook({
    on: "host:command:progressed",
    handler: async ({ command }) => {
      if (command.kind !== "deploy" || command.status !== "done") {
        return;
      }
      const { app, environment, project } = command.payload;
      if (!app || !environment) {
        return;
      }
      const name = project
        ? `${project}-${app}-${environment}`
        : `${app}-${environment}`;
      const copy = await this.instances.findOne({
        where: {
          hostId: { eq: command.hostId },
          resourceName: { eq: name },
        },
      });
      if (copy && copy.resourceHostId !== command.hostId) {
        await this.instances.updateById(copy.id, {
          resourceHostId: command.hostId,
        });
      }
    },
  });

  /**
   * The project segment a Bay deploy sends, taken from the stored name.
   *
   * Bay composes `<project>-<app>` from the command's three strings, so the
   * segment is the stored name with `-<app>-<env>` taken off. `undefined`
   * means a name with no project segment, which is what a project with no slug
   * always deployed as, and the command then carries no `project` at all.
   *
   * ⚠️ **Refused when the copy's app or env was renamed since.** The command
   * carries them as they are NOW, so Bay would compose a different key and
   * start a new, empty instance beside the one this name belongs to. Nothing
   * on the wire can express the old names, so the refusal is the whole fix.
   */
  public projectSegmentOf(
    instance: AppInstance,
    name: string,
  ): string | undefined {
    const bare = `${instance.app}-${instance.env}`;
    if (name === bare) {
      return undefined;
    }
    const suffix = `-${bare}`;
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return name.slice(0, -suffix.length);
    }
    throw new BadRequestError(
      `${instance.app}/${instance.env} was first deployed to this machine as \`${name}\`. Bay names an instance after the app and environment it is sent, so this deploy would start a new, empty instance beside it. Rename the copy back to the names it was deployed under.`,
    );
  }

  /**
   * The name a copy would take if it deployed for the first time now.
   *
   * ⚠️ **Cloudflare** composes it the way `NamingService.forContext` does: the
   * runner used to hand `<project>-<app>` in as the platform name, and the
   * service slugifies that and the env separately, then joins them. Slugifying
   * the whole string in one go truncates at a different place past 63
   * characters, which is where a stored name and a recomputed one would part.
   *
   * ⚠️ **Bay** takes the three strings as they are, because that is what the
   * machine joins: a slugified name would not strip back to the segment Bay
   * has been composing. A project with no slug sent no segment before this
   * existed, and still sends none, so its live instance does not move.
   */
  protected async derive(instance: AppInstance, host: Host): Promise<string> {
    const project = await this.projects.findById(instance.projectId);
    if (host.type === "bay") {
      return project?.slug
        ? `${project.slug}-${instance.app}-${instance.env}`
        : `${instance.app}-${instance.env}`;
    }
    // `slug` is optional on the column; the id is the stable fallback the rest
    // of the app already uses when a title produces nothing sluggable.
    const slug = project?.slug || `project-${instance.projectId}`;
    return `${this.slugify(`${slug}-${instance.app}`)}-${this.slugify(instance.env)}`;
  }

  /**
   * Refuse a name another copy already holds in the same place.
   *
   * ## ⚠️ A rename frees a slug, and the next project may take it
   *
   * `project1` renamed to `project2` keeps `project1-app1-env1`. A new project
   * called `project1` would derive the very same name: `ensureD1` / `ensureR2`
   * resolve by NAME, so its first Cloudflare deploy would attach to the other
   * project's live database, and on Bay it would replace the other project's
   * instance. Moving a copy to a host that already holds its name ends the
   * same way.
   *
   * The place is the Cloudflare ACCOUNT for a Cloudflare host, because two
   * hosts may lend one account, and the host itself for a Bay machine. The
   * other copy is not named: it may belong to a project the caller cannot see.
   */
  protected async assertFree(
    instance: AppInstance,
    host: Host,
    name: string,
  ): Promise<void> {
    const scope = host.accountId
      ? (
          await this.hosts.findMany({
            where: { accountId: { eq: host.accountId } },
            columns: ["id"],
          })
        ).map((it) => it.id)
      : [host.id];
    if (scope.length === 0) {
      return;
    }
    // A copy moved away keeps running under its name where it last deployed
    // (`resourceHostId`) until somebody removes it there: that name is not
    // free either.
    const holder = await this.instances.findOne({
      where: {
        or: [
          { hostId: { inArray: scope } },
          { resourceHostId: { inArray: scope } },
        ],
        resourceName: { eq: name },
        id: { ne: instance.id },
      },
    });
    if (!holder) {
      return;
    }
    throw new BadRequestError(
      host.accountId
        ? `Another copy in this Cloudflare account is already named \`${name}\`, and deploying would share its Worker, database and bucket. Point ${instance.app}/${instance.env} at another host, or rename this project before its first deploy.`
        : `Another copy on this Bay machine is already named \`${name}\`, and deploying would replace its instance. Point ${instance.app}/${instance.env} at another host, or rename this project before its first deploy.`,
    );
  }

  /**
   * ⚠️ Must match `NamingService.slugify`, which is what actually names the
   * Cloudflare resources. It lives in `alepha/cli/infra-lib` beside a class
   * that pulls a Cloudflare client in, so it is restated rather than imported
   * - and the 63-character slice is part of the contract, not a detail.
   */
  protected slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
  }
}
