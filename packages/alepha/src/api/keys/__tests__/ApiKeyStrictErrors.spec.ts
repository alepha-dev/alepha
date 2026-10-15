import { randomUUID } from "node:crypto";

import { Alepha, AlephaError } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, AlephaSecurity } from "alepha/security";
import {
  AlephaServer,
  ForbiddenError,
  HttpError,
  InternalServerError,
  NotFoundError,
} from "alepha/server";
import {
  AlephaServerSwagger,
  ServerSwaggerProvider,
} from "alepha/server/swagger";
import { describe, expect, it } from "vitest";

import { AdminApiKeyController } from "../controllers/AdminApiKeyController.ts";
import { ApiKeyController } from "../controllers/ApiKeyController.ts";
import { AlephaApiKeys } from "../index.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

class TestApp {
  issuer = $issuer({
    secret: "test-secret",
    roles: [{ name: "admin", permissions: [{ name: "*" }] }],
  });
}

/**
 * A service that throws something no action declares, to prove the 500.
 */
class BrokenApiKeyService extends ApiKeyService {
  public override async list(): Promise<never> {
    throw new AlephaError("connection reset");
  }
}

const setup = async (options: { broken?: boolean } = {}) => {
  let alepha = Alepha.create().with({
    provide: LogDestinationProvider,
    use: MemoryDestinationProvider,
  });
  if (options.broken) {
    alepha = alepha.with({ provide: ApiKeyService, use: BrokenApiKeyService });
  }
  alepha = alepha
    .with(AlephaOrmPostgres)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiKeys)
    .with(AlephaServerSwagger)
    .with(TestApp);
  await alepha.start();
  const warnings = () =>
    alepha
      .inject(MemoryDestinationProvider)
      .logs.filter((l) => l.level === "WARN")
      .map((l) => l.message)
      .filter((m) => m.includes("which it does not declare"));
  return { alepha, warnings };
};

const caught = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new AlephaError("expected a rejection");
};

/**
 * `alepha/api/keys` runs in strict mode (#Q2712): every action declares its
 * `errors`, so what a client may receive is the contract, and anything else
 * is a 500.
 */
describe("API keys: strict errors", () => {
  it("answers a missing key with a declared 404, locally and over HTTP", async () => {
    const { alepha, warnings } = await setup();
    const admin = { id: randomUUID(), roles: ["admin"] };
    const controller = alepha.inject(AdminApiKeyController);
    const id = randomUUID();

    expect(
      await caught(() =>
        controller.getApiKey.run({ params: { id } }, { user: admin }),
      ),
    ).toBeInstanceOf(NotFoundError);

    const http = await caught(() =>
      controller.revokeApiKey.fetch({ params: { id } }, { user: admin }),
    );
    expect(http).toBeInstanceOf(NotFoundError);
    expect((http as HttpError).status).toBe(404);
    expect(warnings()).toEqual([]);
  });

  it("answers a key that is not yours with a declared 403", async () => {
    const { alepha, warnings } = await setup();
    const { apiKey } = await alepha
      .inject(ApiKeyService)
      .create({ userId: randomUUID(), name: "theirs", roles: [] });

    const error = await caught(() =>
      alepha
        .inject(ApiKeyController)
        .revokeMyApiKey.fetch(
          { params: { id: apiKey.id } },
          { user: { id: randomUUID(), roles: ["admin"] } },
        ),
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(warnings()).toEqual([]);
  });

  it("turns an undeclared error into a 500 and names it", async () => {
    const { alepha, warnings } = await setup({ broken: true });

    const error = await caught(() =>
      alepha
        .inject(ApiKeyController)
        .listApiKeys.fetch(
          {},
          { user: { id: randomUUID(), roles: ["admin"] } },
        ),
    );
    expect(error).toBeInstanceOf(InternalServerError);
    expect(warnings()).toEqual([
      expect.stringContaining("'listApiKeys' threw AlephaError"),
    ]);
  });

  it("documents the declared errors in OpenAPI", async () => {
    const { alepha } = await setup();
    const doc = alepha.inject(ServerSwaggerProvider).generateSwaggerDoc({});
    const rotate = doc.paths["/api/api-keys/{id}/rotate"].post;

    expect(Object.keys(rotate.responses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "500",
    ]);
  });
});
