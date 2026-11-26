import type { QuestController } from "@lore/plan/api";
import type {
  FolioAttachmentController,
  FolioController,
} from "@lore/remember/api";
import { $inject, AlephaError } from "alepha";
import { NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { FileSystemProvider } from "alepha/system";

import { LoreClientService } from "./LoreClientService.ts";

/**
 * Fetches a file attached to a folio or a quest (#Q4513), the other half of
 * `AttachmentUploader`: MCP carries no bytes since #Q1876, so an agent that
 * needs a mockup attached to a folio reads it here.
 *
 * The attachment is found through `$client` (the folio's list, by name or
 * shortId; the quest's list, by name or file id), then its bytes are read
 * from `GET /api/files/:id`, which Lore authorizes per project like the
 * page does, and written as they arrive: never parsed, so a JSON or HTML
 * file lands byte for byte. That one URL is addressed by path, as the
 * uploader's two are.
 */
export class AttachmentDownloader {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly client = $inject(LoreClientService);

  /**
   * ⚠️ Declared after `client`: a field initializer reading another field
   * sees `undefined` if that field is declared below it.
   */
  protected readonly quests = $client<QuestController>(this.client.scope());
  protected readonly folios = $client<FolioController>(this.client.scope());
  protected readonly folioAttachments = $client<FolioAttachmentController>(
    this.client.scope(),
  );

  /**
   * A folio's attachment, by its name or its shortId.
   */
  public async pullFromFolio(input: {
    projectId: number;
    folioShortId: number;
    ref: string;
    root: string;
    out?: string;
  }): Promise<AttachmentPulled> {
    const folio = await this.folios.getByShortId({
      params: { projectId: input.projectId, shortId: input.folioShortId },
    });
    const files = await this.folioAttachments.listAttachments({
      params: { folioId: folio.id },
    });
    const byShortId = /^\d+$/.test(input.ref) ? Number(input.ref) : undefined;
    const found =
      files.find((it) => it.name === input.ref) ??
      files.find((it) => it.shortId === byShortId);
    if (!found) {
      throw new NotFoundError(
        `No attachment "${input.ref}" on folio #F${input.folioShortId}: ${files.map((it) => `${it.name} (${it.shortId})`).join(", ") || "it has none"}`,
      );
    }
    return this.save(
      found.id,
      found.name,
      found.size,
      await this.target(input.root, found.name, input.out),
    );
  }

  /**
   * A quest's attachment, by its name or its file id.
   */
  public async pullFromQuest(input: {
    projectId: number;
    questShortId: number;
    ref: string;
    root: string;
    out?: string;
  }): Promise<AttachmentPulled> {
    const quest = await this.quests.getQuestByShortId({
      params: { projectId: input.projectId, shortId: input.questShortId },
    });
    const files = await this.quests.listQuestAttachments({
      params: { id: quest.id },
    });
    const found =
      files.find((it) => it.name === input.ref) ??
      files.find((it) => it.fileId === input.ref);
    if (!found) {
      throw new NotFoundError(
        `No attachment "${input.ref}" on quest #Q${input.questShortId}: ${files.map((it) => it.name).join(", ") || "it has none"}`,
      );
    }
    return this.save(
      found.fileId,
      found.name,
      found.size,
      await this.target(input.root, found.name, input.out),
    );
  }

  /**
   * Where the file goes: `out` as given when it names a file, inside it when
   * it is a directory, the attachment's own name in the current directory
   * when absent. The stored name is reduced to its last segment, so a name
   * can never write outside the directory asked for.
   */
  public async target(
    root: string,
    name: string,
    out: string | undefined,
  ): Promise<string> {
    const base = name.split(/[\\/]/).findLast(Boolean) ?? "attachment";
    if (base === "." || base === "..") {
      throw new AlephaError(`Cannot save an attachment named "${name}"`);
    }
    const dir = root.replace(/\/$/, "");
    if (!out) return `${dir}/${base}`;
    const path = out.startsWith("/") ? out : `${dir}/${out}`;
    if (out.endsWith("/") || (await this.isDirectory(path))) {
      return `${path.replace(/\/$/, "")}/${base}`;
    }
    return path;
  }

  protected async isDirectory(path: string): Promise<boolean> {
    try {
      return (await this.fs.stat(path)).isDirectory;
    } catch {
      return false;
    }
  }

  protected async save(
    fileId: string,
    name: string,
    size: number | undefined,
    out: string,
  ): Promise<AttachmentPulled> {
    const response = await this.download(
      `${this.client.hostname()}/api/files/${fileId}`,
      await this.client.authorization(),
    );
    if (!response.ok || !response.body) {
      throw new AlephaError(
        `Downloading ${name} failed: HTTP ${response.status} ${response.statusText}`,
      );
    }
    // `--out pulled/` names a directory that may not exist yet.
    const parent = out.slice(0, out.lastIndexOf("/"));
    if (parent) await this.fs.mkdir(parent, { recursive: true });
    await this.fs.writeFile(out, this.fs.createFile({ response, name }));
    return { name, path: out, ...(size === undefined ? {} : { size }) };
  }

  /**
   * The bytes' request, raw: the response is streamed to disk as it is,
   * which `HttpClient` would parse for a JSON or text file.
   */
  protected download(url: string, authorization: string): Promise<Response> {
    return fetch(url, { headers: { authorization } });
  }
}

export interface AttachmentPulled {
  name: string;
  /**
   * Where it was written.
   */
  path: string;
  size?: number;
}
