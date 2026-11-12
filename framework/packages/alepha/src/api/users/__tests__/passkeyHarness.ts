import { Alepha } from "alepha";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaReactAuth, PasskeyClient } from "alepha/react/auth";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import {
  AlephaTestingWebAuthn,
  MemoryAuthenticator,
  MemoryPasskeyClient,
} from "alepha/testing/webauthn";

import type { RealmAuthSettings } from "../atoms/realmAuthSettingsAtom.ts";
import { AlephaApiUsers } from "../index.ts";
import { $realm, type RealmFeatures } from "../primitives/$realm.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";

/**
 * A realm with passkeys on, served for real, and a browser to drive it: a
 * cookie jar, a bearer session per signed-in user, and a
 * {@link MemoryAuthenticator} whose origin is the server's.
 *
 * The passkey routes read their challenge from a cookie, so the specs go
 * over HTTP rather than calling actions in process.
 */
export class PasskeyHarness {
  public alepha!: Alepha;
  public hostname!: string;
  public device!: MemoryAuthenticator;
  public email!: MemoryEmailProvider;

  public static async boot(
    options: {
      databaseUrl?: string;
      settings?: Partial<RealmAuthSettings>;
      features?: RealmFeatures;
      /**
       * A second realm, with passkeys on, beside the default one.
       */
      secondRealm?: string;
      /**
       * Register `alepha/react/auth` with a `MemoryPasskeyClient`, to drive
       * `ReactAuth` against this server.
       */
      reactAuth?: boolean;
    } = {},
  ): Promise<PasskeyHarness> {
    const harness = new PasskeyHarness();
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        ...(options.databaseUrl ? { DATABASE_URL: options.databaseUrl } : {}),
      },
    });
    if (options.reactAuth) {
      // Before the module that resolves it.
      alepha.with({ provide: PasskeyClient, use: MemoryPasskeyClient });
    }
    alepha.with(AlephaServer);
    alepha.with(AlephaOrmTestPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaTestingWebAuthn);
    alepha.with(AlephaApiUsers);
    if (options.reactAuth) {
      alepha.with(AlephaReactAuth);
    }
    alepha.with(() => ({
      realm: $realm({
        settings: {
          passkeys: "optional",
          ...options.settings,
        } as RealmAuthSettings,
        features: options.features,
      }),
      ...(options.secondRealm
        ? {
            second: $realm({
              issuer: { name: options.secondRealm },
              settings: { passkeys: "optional" } as RealmAuthSettings,
            }),
          }
        : {}),
    }));
    await alepha.start();
    harness.alepha = alepha;
    harness.hostname = alepha.inject(ServerProvider).hostname;
    harness.device = alepha.inject(MemoryAuthenticator);
    harness.device.origin = harness.hostname;
    harness.email = alepha.inject(MemoryEmailProvider);
    harness.email.records = [];
    return harness;
  }

  /**
   * Another device: a second authenticator with its own credentials, as a
   * phone beside a laptop.
   */
  public newDevice(): MemoryAuthenticator {
    const device = this.alepha.inject(MemoryAuthenticator, {
      lifetime: "transient",
    });
    device.origin = this.hostname;
    return device;
  }

  /**
   * A browser with no session, for the sign-in routes.
   */
  public anonymous(): PasskeyBrowser {
    return new PasskeyBrowser(this, "", "");
  }

  public get realm() {
    return this.alepha.inject(RealmProvider);
  }

  /**
   * A user with an email and, unless `password: false`, a password.
   */
  public async user(
    options: { password?: false | string } = {},
  ): Promise<{ id: string; email: string; password: string }> {
    const email = `pk-${Math.floor(Math.random() * 1e12)}@example.test`;
    const password = options.password || "Secret-123";
    const user = await this.realm.userRepository().create({
      email,
      emailVerified: true,
      realm: this.realm.getRealm().name,
    });
    await this.realm.identityRepository().create({
      provider: "credentials",
      userId: user.id,
      password: await this.alepha.inject(CryptoProvider).hashPassword(password),
    });
    return { id: user.id, email, password };
  }

  /**
   * Sign in with the password and return a browser for that session. With
   * `dropPassword`, the credentials row is removed afterwards: an account
   * that no longer has a password, signed in.
   */
  public async signIn(
    user: { id: string; email: string; password: string },
    options: { dropPassword?: boolean } = {},
  ): Promise<PasskeyBrowser> {
    const response = await fetch(
      `${this.hostname}/_auth/token?provider=credentials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: user.email, password: user.password }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Sign-in failed: ${response.status} ${await response.text()}`,
      );
    }
    const tokens = (await response.json()) as { access_token: string };
    if (options.dropPassword) {
      await this.realm.identityRepository().deleteMany({
        userId: { eq: user.id },
        provider: { eq: "credentials" },
      });
    }
    return new PasskeyBrowser(this, user.id, tokens.access_token);
  }
}

/**
 * One signed-in browser: a bearer token and a cookie jar.
 */
export class PasskeyBrowser {
  public readonly jar = new Map<string, string>();
  public readonly harness: PasskeyHarness;
  public readonly userId: string;
  public readonly accessToken: string;

  constructor(harness: PasskeyHarness, userId: string, accessToken: string) {
    this.harness = harness;
    this.userId = userId;
    this.accessToken = accessToken;
  }

  public async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await fetch(`${this.harness.hostname}${path}`, {
      method,
      headers: {
        ...(this.accessToken
          ? { authorization: `Bearer ${this.accessToken}` }
          : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";");
      const at = pair!.indexOf("=");
      const name = pair!.slice(0, at).trim();
      const value = pair!.slice(at + 1).trim();
      const expired = attributes.some((it) =>
        /max-age=0|expires=thu, 01 jan 1970/i.test(it.trim()),
      );
      if (!value || expired) {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : undefined,
    };
  }

  /**
   * Options, the device's answer, then the write: the whole add.
   */
  public async addPasskey(
    proof?: Record<string, unknown>,
    name = "Laptop",
    device = this.harness.device,
  ): Promise<{ status: number; body: any }> {
    const options = await this.call("POST", "/api/users/me/passkeys/options");
    if (options.status !== 200) {
      return options;
    }
    const credential = await device.create(options.body);
    return this.call("POST", "/api/users/me/passkeys", {
      credential,
      name,
      proof,
    });
  }

  /**
   * A step-up assertion from the device, for the proof of a write.
   */
  public async stepUp(
    knobs: Parameters<MemoryAuthenticator["get"]>[1] = {},
  ): Promise<unknown> {
    const options = await this.call(
      "POST",
      "/api/users/me/passkeys/proof/options",
    );
    if (options.status !== 200) {
      throw new Error(`proof options: ${options.status}`);
    }
    return this.harness.device.get(options.body, knobs);
  }

  /**
   * The passkey sign-in: options, the device's assertion, verify.
   */
  public async signInWithPasskey(
    knobs: Parameters<MemoryAuthenticator["get"]>[1] = {},
    device = this.harness.device,
    query = "",
  ): Promise<{ status: number; body: any }> {
    const options = await this.call(
      "POST",
      `/_auth/passkey/options${query}`,
      {},
    );
    if (options.status !== 200) {
      return options;
    }
    const credential = await device.get(options.body, knobs);
    return this.call("POST", `/_auth/passkey/verify${query}`, { credential });
  }

  public async list(): Promise<{ proof: string; items: any[] }> {
    return (await this.call("GET", "/api/users/me/passkeys")).body;
  }
}
