import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { $env, Alepha, z } from "alepha";
import { $job, AlephaApiJobs } from "alepha/api/jobs";
import { AlephaInspector } from "alepha/inspector";
import { $entity, $repository, db } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { $secure, AlephaSecurity } from "alepha/security";
import { $action, HttpError } from "alepha/server";
import { FileSystemProvider, NodeFileSystemProvider } from "alepha/system";

import { DevMcpServer } from "../../mcp/DevMcpServer.ts";

/**
 * The value of the fixture's secret env variable: no tool output may hold it.
 */
export const FIXTURE_SECRET = "sk_fixture_never_leaves";

export const NoteMissing = HttpError.extend({
  name: "NOTE_MISSING",
  default: { status: 404 },
});

export const notes = $entity({
  name: "mcp_fixture_notes",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    title: z.text(),
    shareToken: z.text({ secret: true }).optional(),
  }),
});

/**
 * A small app with one of each thing the MCP tools read: a secured action
 * declaring an error, a page, an entity with a secret column, a job and a
 * secret env variable.
 */
export class NotesApp {
  protected readonly env = $env(
    z.object({ MCP_FIXTURE_SECRET: z.text().optional() }),
  );

  public readonly repo = $repository(notes);

  public readonly getNote = $action({
    method: "GET",
    path: "/notes/:id",
    description: "Read one note",
    use: [$secure({ roles: ["admin"] })],
    errors: [NoteMissing],
    schema: {
      params: z.object({ id: z.integer() }),
      response: z.object({ id: z.integer(), title: z.text() }),
    },
    handler: async ({ params }) => {
      const note = await this.repo.findById(params.id).catch(() => undefined);
      if (!note) throw new NoteMissing("No such note");
      return { id: note.id, title: note.title };
    },
  });

  public readonly home = $page({
    path: "/",
    component: () => null,
  });

  public readonly sweep = $job({
    name: "notes.sweep",
    description: "Delete old notes",
    schema: z.object({ olderThanDays: z.integer() }),
    handler: async () => {},
  });
}

/**
 * The running fixture app, and an `alepha mcp` server over it, sharing a
 * run directory as two processes would.
 */
export const startFixture = async (
  services: any[] = [NotesApp],
): Promise<{
  app: Alepha;
  server: Alepha;
  call: (name: string, params?: Record<string, unknown>) => Promise<string>;
  stop: () => Promise<void>;
}> => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-"));
  const env = { ALEPHA_RUN_DIR: join(dir, "run"), LOG_LEVEL: "error" };

  const app = Alepha.create({
    env: { ...env, ALEPHA_INSPECT: "1", MCP_FIXTURE_SECRET: FIXTURE_SECRET },
  })
    .with({ provide: FileSystemProvider, use: NodeFileSystemProvider })
    .with(AlephaOrmPostgres)
    .with(AlephaApiJobs)
    .with(AlephaSecurity)
    .with(AlephaReactRouter)
    .with(AlephaInspector);
  for (const service of services) app.with(service);
  await app.start();

  const server = new DevMcpServer().create(process.cwd(), env, [
    { provide: FileSystemProvider, use: NodeFileSystemProvider },
  ]);
  await server.start();

  const { McpServerProvider } = await import("alepha/mcp");
  const call = async (name: string, params: Record<string, unknown> = {}) => {
    const tool = server.inject(McpServerProvider).getTool(name);
    if (!tool) throw new Error(`no tool ${name}`);
    return (await tool.execute(params)) as string;
  };

  return {
    app,
    server,
    call,
    stop: async () => {
      await server.stop();
      await app.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};
