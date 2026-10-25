import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import {
  type RegistryCredentialRow,
  registryCredentials,
} from "../entities/registryCredentials.ts";
import { CredentialSealService } from "./CredentialSealService.ts";
import type { RegistryCredential } from "./ImageRegistryClient.ts";

/**
 * A project's registry credentials: set, list without secrets, remove, and
 * open, which only server-side code calls (an image verification at push,
 * and a deploy of the same project's stack).
 */
export class RegistryCredentialService {
  protected readonly rows = $repository(registryCredentials);
  protected readonly seal = $inject(CredentialSealService);

  /**
   * A registry host: a hostname with an optional port, no scheme, no path, no
   * IP literal. What `docker login` takes.
   */
  normalizeHost(raw: string): string {
    const host = raw.trim().toLowerCase();
    const match =
      /^([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)(:(\d{1,5}))?$/.exec(
        host,
      );
    const port = match?.[6] ? Number(match[6]) : undefined;
    if (
      !match ||
      /^[\d.]+$/.test(match[1]) ||
      (port !== undefined && (port < 1 || port > 65535))
    ) {
      throw new BadRequestError(
        `${raw} is not a registry host: write it as docker login takes it, e.g. registry.gitlab.com`,
      );
    }
    return host;
  }

  async list(projectId: number): Promise<RegistryCredentialRow[]> {
    return await this.rows.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: { column: "host", direction: "asc" },
    });
  }

  async set(input: {
    projectId: number;
    host: string;
    username: string;
    secret: string;
    updatedBy?: string;
  }): Promise<RegistryCredentialRow> {
    const host = this.normalizeHost(input.host);
    const secretSealed = await this.seal.seal(
      input.secret,
      CredentialSealService.REGISTRY_PURPOSE,
    );
    const existing = await this.rows.findOne({
      where: { projectId: { eq: input.projectId }, host: { eq: host } },
    });
    if (existing) {
      return await this.rows.updateById(existing.id, {
        username: input.username,
        secretSealed,
        keyVersion: CredentialSealService.KEY_VERSION,
        updatedBy: input.updatedBy ?? null,
      });
    }
    return await this.rows.create({
      projectId: input.projectId,
      host,
      username: input.username,
      secretSealed,
      keyVersion: CredentialSealService.KEY_VERSION,
      updatedBy: input.updatedBy,
    });
  }

  async remove(projectId: number, rawHost: string): Promise<void> {
    const host = this.normalizeHost(rawHost);
    const existing = await this.rows.findOne({
      where: { projectId: { eq: projectId }, host: { eq: host } },
    });
    if (!existing) {
      throw new NotFoundError(`This project holds no credential for ${host}`);
    }
    await this.rows.deleteById(existing.id);
  }

  /**
   * The opened credential for one host of one project, or undefined.
   *
   * ⚠️ Server-side only. Its callers are image verification and the deploy;
   * no controller returns what it answers.
   */
  async open(
    projectId: number,
    host: string,
  ): Promise<RegistryCredential | undefined> {
    const row = await this.rows.findOne({
      where: { projectId: { eq: projectId }, host: { eq: host.toLowerCase() } },
    });
    if (!row) {
      return undefined;
    }
    return {
      host: row.host,
      username: row.username,
      password: await this.seal.open(
        row.secretSealed,
        CredentialSealService.REGISTRY_PURPOSE,
      ),
    };
  }

  /**
   * Every credential of one project, opened, for the deploy of that
   * project's stack: the estate pulls the stack's images with them. Scoped by
   * project in the query itself, so another project's credential cannot be
   * reached from here.
   */
  async forDeploy(projectId: number): Promise<RegistryCredential[]> {
    const rows = await this.list(projectId);
    return await Promise.all(
      rows.map(async (row) => ({
        host: row.host,
        username: row.username,
        password: await this.seal.open(
          row.secretSealed,
          CredentialSealService.REGISTRY_PURPOSE,
        ),
      })),
    );
  }
}
