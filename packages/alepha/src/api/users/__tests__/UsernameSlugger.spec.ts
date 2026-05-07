import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { describe, expect, it } from "vitest";
import { realmAuthSettingsAtom } from "../atoms/realmAuthSettingsAtom.ts";
import { AlephaApiUsers, RealmProvider, UsernameSlugger } from "../index.ts";

const setup = async (realmSettings?: Record<string, unknown>) => {
  const alepha = Alepha.create();
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);

  await alepha.start();

  if (realmSettings) {
    alepha.inject(RealmProvider).register("default", {
      settings: realmSettings as never,
    });
  }

  // Wipe users table between cases so collision tests don't interfere.
  const users = alepha.inject(RealmProvider).userRepository();
  await users.deleteMany({});

  return {
    alepha,
    slugger: alepha.inject(UsernameSlugger),
    users,
  };
};

// ---------------------------------------------------------------------------------------------------------------------

describe("UsernameSlugger.slug — pure rule", () => {
  it("strips the domain and the gmail '+suffix' is kept verbatim", async () => {
    const { slugger } = await setup();
    expect(slugger.slug("ni.foures+testkv@gmail.com")).toBe("ni-foures-testkv");
  });

  it("collapses runs of non-alphanumeric chars and trims edges", async () => {
    const { slugger } = await setup();
    expect(slugger.slug("john...doe@example.com")).toBe("john-doe");
    expect(slugger.slug("---weird---name---@x.io")).toBe("weird-name");
  });

  it("lowercases the result", async () => {
    const { slugger } = await setup();
    expect(slugger.slug("Alice.SMITH@Example.com")).toBe("alice-smith");
  });

  it("drops every non-[a-z0-9] char (no NFD normalize)", async () => {
    // `é` is dropped, so `josé` becomes `jos` — and then padded to MIN_LENGTH.
    const { slugger } = await setup();
    const result = slugger.slug("josé@example.com");
    expect(result.startsWith("jos")).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(UsernameSlugger.MIN_LENGTH);
  });

  it("pads short slugs with random alphanumerics", async () => {
    const { slugger } = await setup();
    const result = slugger.slug("a@example.com");
    expect(result.startsWith("a")).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(UsernameSlugger.MIN_LENGTH);
    expect(result).toMatch(/^[a-z0-9-]+$/);
  });

  it("falls back to the EMPTY_LOCAL_FALLBACK when the local part has no [a-z0-9]", async () => {
    const { slugger } = await setup();
    expect(slugger.slug("é@example.com")).toBe(
      UsernameSlugger.EMPTY_LOCAL_FALLBACK,
    );
  });

  it("clamps to MAX_LENGTH", async () => {
    const { slugger } = await setup();
    const long = `${"a".repeat(60)}@example.com`;
    expect(slugger.slug(long).length).toBe(UsernameSlugger.MAX_LENGTH);
  });

  it("treats null/empty input by returning the fallback", async () => {
    const { slugger } = await setup();
    expect(slugger.slug(null)).toBe(UsernameSlugger.EMPTY_LOCAL_FALLBACK);
    expect(slugger.slug("")).toBe(UsernameSlugger.EMPTY_LOCAL_FALLBACK);
    expect(slugger.slug(undefined)).toBe(UsernameSlugger.EMPTY_LOCAL_FALLBACK);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("UsernameSlugger.pickAvailable — DB-backed availability + retry", () => {
  it("returns the base when nothing collides", async () => {
    const { slugger } = await setup();
    const picked = await slugger.pickAvailable("default", "alice");
    expect(picked).toBe("alice");
  });

  it("appends a 4-char random suffix when the base is taken", async () => {
    const { slugger, users } = await setup();
    await users.create({ realm: "default", username: "alice", email: "a@x" });

    const picked = await slugger.pickAvailable("default", "alice");
    expect(picked).toMatch(/^alice-[a-z0-9]{4}$/);
  });

  it("treats blocklisted candidates as collisions and falls through to the suffix path", async () => {
    const { slugger } = await setup({ usernameBlocklist: ["admin", "root"] });

    const picked = await slugger.pickAvailable("default", "admin");
    expect(picked).toMatch(/^admin-[a-z0-9]{4}$/);
  });

  it("trims the base before adding the suffix when MAX_LENGTH would be exceeded", async () => {
    const { slugger, users } = await setup();
    const long = "a".repeat(UsernameSlugger.MAX_LENGTH);
    await users.create({ realm: "default", username: long, email: "a@x" });

    const picked = await slugger.pickAvailable("default", long);
    expect(picked.length).toBeLessThanOrEqual(UsernameSlugger.MAX_LENGTH);
    expect(picked).toMatch(/-[a-z0-9]{4}$/);
  });

  it("blocklist match is case-insensitive", async () => {
    const { slugger } = await setup({ usernameBlocklist: ["Admin"] });
    expect(await slugger.isBlocked("default", "admin")).toBe(true);
    expect(await slugger.isBlocked("default", "ADMIN")).toBe(true);
    expect(await slugger.isBlocked("default", "user")).toBe(false);
  });

  it("default blocklist is empty — no name is implicitly reserved", async () => {
    const { alepha, slugger } = await setup();
    const settings = alepha.get(realmAuthSettingsAtom);
    expect(settings.usernameBlocklist).toEqual([]);

    const picked = await slugger.pickAvailable("default", "admin");
    expect(picked).toBe("admin");
  });
});
