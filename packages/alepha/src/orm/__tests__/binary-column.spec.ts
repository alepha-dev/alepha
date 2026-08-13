import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const blobs = $entity({
  name: "test_binary_blobs",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    payload: z.binary(),
  }),
});

class App {
  repository = $repository(blobs);
}

// `z.binary()` is a string carrying `format: "binary"`, so this is what the
// schema actually admits: base64 of bytes that are not valid UTF-8.
const PAYLOAD = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f, 0xfe]).toString(
  "base64",
);

const testBinaryRoundTrip = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  await app.repository.create({ payload: PAYLOAD });

  const rows = await app.repository.findMany();

  // The same entity and the same input must produce the same value on every
  // dialect — postgres stored it as bytea (Buffer out) while sqlite stored it
  // as JSON text (string out).
  expect(rows[0].payload).toBe(PAYLOAD);
};

describe("binary columns", () => {
  it("should round-trip bytes (sqlite)", async () => {
    await testBinaryRoundTrip(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });

  it("should round-trip bytes (postgres)", async () => {
    await testBinaryRoundTrip(Alepha.create().with(AlephaOrmPostgres));
  });
});
