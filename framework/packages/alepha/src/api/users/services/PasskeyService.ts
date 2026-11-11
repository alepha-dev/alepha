import { $inject, Alepha, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { DbConflictError } from "alepha/orm";
import { $rateLimit } from "alepha/rate-limit";
import {
  type AuthenticationOptionsJson,
  type AuthenticationResponseJson,
  Base64Url,
  CoseKey,
  type RegistrationOptionsJson,
  type RegistrationResponseJson,
  type WebAuthnOriginRule,
  type WebAuthnPublicKeyJwk,
  WebAuthnError,
  WebAuthnVerifier,
} from "alepha/security";
import { NotFoundError, TooManyRequestsError } from "alepha/server";
import { $cookie, type Cookies } from "alepha/server/cookies";

import type { RealmAuthSettings } from "../atoms/realmAuthSettingsAtom.ts";
import { UserAudits } from "../audits/UserAudits.ts";
import type { IdentityEntity } from "../entities/identities.ts";
import type { UserEntity } from "../entities/users.ts";
import {
  LastSignInMethodError,
  PasskeyAssertionProofError,
  PasskeyChallengeError,
  PasskeyConflictError,
  PasskeyLimitError,
  PasskeyPasswordProofError,
  PasskeysDisabledError,
} from "../errors/PasskeyError.ts";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import type { MyPasskeyList } from "../schemas/myPasskeyListSchema.ts";
import type { PasskeyIdentityData } from "../schemas/passkeyIdentityDataSchema.ts";
import type { PasskeyProofKind } from "../schemas/passkeyProofKindSchema.ts";
import type { PasskeyProof } from "../schemas/passkeyProofSchema.ts";

/**
 * Where a ceremony runs: the relying party, and the origin rule a response
 * must meet. Derived from the request unless the realm sets
 * `passkeyRelyingParty`.
 */
export interface PasskeyRelyingParty {
  rpId: string;
  name: string;
  origin: WebAuthnOriginRule;
}

/**
 * The caller of an account-side ceremony.
 */
export interface PasskeyCaller {
  id: string;
  realm?: string;
}

/**
 * Passkeys of a realm: enrolment, listing, renaming and removal on the
 * account, the proof those writes ask for, and the assertion check the
 * sign-in routes and the step-up proof share.
 *
 * A passkey is an `identities` row (`provider: "passkey"`, the credential
 * id in `providerUserId`, {@link PasskeyIdentityData} in `providerData`):
 * no migration. `identities` has no realm column, so every lookup by id or
 * credential id checks the owning user's realm.
 *
 * Challenges are stateless: an options call sets a signed, encrypted,
 * five-minute `httpOnly` cookie holding the challenge, the ceremony and the
 * user (one cookie per ceremony), and the matching write reads and clears it.
 */
export class PasskeyService {
  /**
   * The identity provider of a passkey row, and the `$auth` provider a
   * passkey session names.
   */
  public readonly provider = "passkey" as const;

  /**
   * How many passkeys one account may hold.
   */
  public readonly maxPerUser = 10;

  /**
   * The longest credential id stored, base64url: `providerUserId` is a
   * 255-character text column. Platform authenticators use 16 to 64 bytes.
   */
  public readonly maxCredentialIdLength = 255;

  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly verifier = $inject(WebAuthnVerifier);
  protected readonly cose = $inject(CoseKey);
  protected readonly base64url = $inject(Base64Url);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The enrolment challenge, set by the registration options and read by
   * the registration.
   */
  protected readonly createChallenge = $cookie({
    name: "passkeyChallenge",
    ttl: [5, "minutes"],
    httpOnly: true,
    sign: true,
    encrypt: true,
    browserPrefix: "__Host-Http-",
    schema: z.object({
      challenge: z.text({ trim: false }),
      ceremony: z.literal("create"),
      userId: z.text(),
      realm: z.text().optional(),
    }),
  });

  /**
   * The step-up challenge, a cookie of its own: adding a passkey runs the
   * proof ceremony and then the enrolment, and one cookie would have the
   * second options call overwrite the first challenge.
   */
  protected readonly proofChallenge = $cookie({
    name: "passkeyProof",
    ttl: [5, "minutes"],
    httpOnly: true,
    sign: true,
    encrypt: true,
    browserPrefix: "__Host-Http-",
    schema: z.object({
      challenge: z.text({ trim: false }),
      ceremony: z.literal("proof"),
      userId: z.text(),
      realm: z.text().optional(),
    }),
  });

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The relying party of a request, by the realm's settings or the request
   * URL: the RP id is the hostname without the port, the name the realm's
   * `displayName`, else its name, and the origin is compared by host.
   */
  public relyingParty(
    settings: RealmAuthSettings,
    realmName: string,
    url: URL,
  ): PasskeyRelyingParty {
    const override = settings.passkeyRelyingParty;
    return {
      rpId: override?.id ?? url.hostname,
      name: override?.name ?? (settings.displayName || realmName),
      origin: override?.origins?.length
        ? { origins: override.origins }
        : { host: url.host },
    };
  }

  /**
   * A passkey signs in here when the realm offers passkeys and it was made
   * for this RP id. The one test that decides whether a passkey counts as a
   * way in and whether it can be asked for as proof.
   */
  public isUsable(
    identity: { providerData?: unknown },
    settings: RealmAuthSettings,
    rpId: string,
  ): boolean {
    return (
      settings.passkeys === "optional" && this.dataOf(identity).rpId === rpId
    );
  }

  /**
   * The user's passkey rows, oldest first.
   */
  public async passkeysOf(
    userId: string,
    realm?: string,
  ): Promise<IdentityEntity[]> {
    return this.identities(realm).findMany({
      where: { userId: { eq: userId }, provider: { eq: this.provider } },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
  }

  /**
   * Whether the user holds a passkey usable here: what a pending second
   * factor offers as `passkey` on its challenge.
   */
  public async hasUsablePasskey(
    userId: string,
    realm: string | undefined,
    url: URL,
  ): Promise<boolean> {
    const settings = await this.settings(realm);
    if (settings.passkeys !== "optional") {
      return false;
    }
    const rp = this.relyingParty(settings, this.realmName(realm), url);
    return (await this.passkeysOf(userId, realm)).some((row) =>
      this.isUsable(row, settings, rp.rpId),
    );
  }

  /**
   * The user's identities that are a way to sign in: every row but the
   * TOTP enrolment, with passkeys counted only while usable. Shared by the
   * passkey removal and `MyIdentityController.unlinkMyIdentity`, so "the
   * last way in" means one thing.
   */
  public async waysToSignIn(
    userId: string,
    realm: string | undefined,
    rpId: string,
  ): Promise<IdentityEntity[]> {
    const settings = await this.settings(realm);
    const rows = await this.identities(realm).findMany({
      where: { userId: { eq: userId }, provider: { ne: "totp" } },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
    return rows.filter(
      (row) =>
        row.provider !== this.provider || this.isUsable(row, settings, rpId),
    );
  }

  /**
   * Which proof adding or removing a passkey asks of this account: the
   * password wins over a passkey when the account has both.
   */
  public async proofKind(
    userId: string,
    realm: string | undefined,
    rpId: string,
  ): Promise<PasskeyProofKind> {
    const credentials = await this.identities(realm).findOne({
      where: { userId: { eq: userId }, provider: { eq: "credentials" } },
    });
    if (credentials?.password) {
      return "password";
    }
    const settings = await this.settings(realm);
    const passkeys = await this.passkeysOf(userId, realm);
    if (passkeys.some((row) => this.isUsable(row, settings, rpId))) {
      return "passkey";
    }
    return "none";
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Registration options for the caller, and the `create` challenge cookie.
   */
  public async registrationOptions(
    caller: PasskeyCaller,
    url: URL,
    cookies?: Cookies,
  ): Promise<RegistrationOptionsJson> {
    const settings = await this.assertEnabled(caller.realm);
    const rp = this.relyingParty(settings, this.realmName(caller.realm), url);
    const user = await this.userOf(caller);
    const existing = await this.passkeysOf(caller.id, caller.realm);
    this.assertBelowCap(existing.length);

    const challenge = this.newChallenge();
    this.createChallenge.set(
      { challenge, ceremony: "create", userId: caller.id, realm: caller.realm },
      { cookies },
    );

    const label = user.email ?? user.username ?? user.id;
    return {
      rp: { id: rp.rpId, name: rp.name },
      user: {
        id: this.base64url.encode(new TextEncoder().encode(user.id)),
        name: label,
        displayName:
          [user.firstName, user.lastName].filter(Boolean).join(" ") || label,
      },
      challenge,
      pubKeyCredParams: this.cose.algorithms.map((alg) => ({
        type: "public-key" as const,
        alg,
      })),
      timeout: 300_000,
      excludeCredentials: existing.map((row) => ({
        type: "public-key" as const,
        id: row.providerUserId!,
        transports: this.dataOf(row).transports,
      })),
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "preferred",
      },
      attestation: "none",
    };
  }

  /**
   * Verify a registration and store the passkey. The proof is checked
   * first, then the challenge is read and cleared.
   */
  public async register(
    caller: PasskeyCaller,
    input: {
      credential: RegistrationResponseJson;
      name?: string;
      proof?: PasskeyProof;
    },
    url: URL,
    cookies?: Cookies,
  ): Promise<IdentityEntity> {
    const settings = await this.assertEnabled(caller.realm);
    const rp = this.relyingParty(settings, this.realmName(caller.realm), url);
    await this.assertProof(caller, input.proof, rp, cookies);

    const challenge = this.takeChallenge("create", caller, cookies);
    const existing = await this.passkeysOf(caller.id, caller.realm);
    this.assertBelowCap(existing.length);

    const verified = await this.verifier.verifyRegistration(input.credential, {
      challenge,
      rpId: rp.rpId,
      origin: rp.origin,
    });
    if (verified.credentialId.length > this.maxCredentialIdLength) {
      throw new WebAuthnError(
        { reason: "credential" },
        { message: "This passkey's credential id is too long to store" },
      );
    }
    const taken = await this.identities(caller.realm).findOne({
      where: {
        provider: { eq: this.provider },
        providerUserId: { eq: verified.credentialId },
      },
    });
    if (taken) {
      throw new PasskeyConflictError();
    }

    const now = this.dateTime.nowISOString();
    const data: PasskeyIdentityData = {
      publicKey: verified.publicKey,
      signCount: verified.signCount,
      transports: verified.transports,
      aaguid: verified.aaguid,
      backupEligible: verified.flags.backupEligible,
      backedUp: verified.flags.backedUp,
      rpId: rp.rpId,
      name: this.cleanName(input.name) ?? "Passkey",
      createdAt: now,
    };

    let identity: IdentityEntity;
    try {
      identity = await this.identities(caller.realm).create({
        userId: caller.id,
        provider: this.provider,
        providerUserId: verified.credentialId,
        providerData: data,
      });
    } catch (error) {
      // Two racing enrolments of one credential: the unique index decides.
      if (DbConflictError.find(error)) {
        throw new PasskeyConflictError();
      }
      throw error;
    }

    const user = await this.userOf(caller);
    await this.audit(caller, user, "passkey_add", identity, data.name);
    await this.notify(caller.realm, user, "added", data.name);
    this.log.info("Passkey added", {
      userId: caller.id,
      identityId: identity.id,
      format: verified.format,
    });
    return identity;
  }

  /**
   * The caller's passkeys and the proof the account owes.
   */
  public async list(caller: PasskeyCaller, url: URL): Promise<MyPasskeyList> {
    const settings = await this.settings(caller.realm);
    const rp = this.relyingParty(settings, this.realmName(caller.realm), url);
    const rows = await this.passkeysOf(caller.id, caller.realm);
    return {
      proof: await this.proofKind(caller.id, caller.realm, rp.rpId),
      items: rows.map((row) => {
        const data = this.dataOf(row);
        return {
          id: row.id,
          name: data.name,
          createdAt: data.createdAt,
          lastUsedAt: data.lastUsedAt,
          backedUp: data.backedUp,
          usable: this.isUsable(row, settings, rp.rpId),
        };
      }),
    };
  }

  /**
   * Rename one of the caller's passkeys. Asks for no proof and sends no
   * email: a name changes nothing about who can sign in.
   */
  public async rename(
    caller: PasskeyCaller,
    id: string,
    name: string,
  ): Promise<void> {
    const row = await this.ownPasskey(caller, id);
    const data = {
      ...this.dataOf(row),
      name: this.cleanName(name) ?? "Passkey",
    };
    await this.identities(caller.realm).updateById(row.id, {
      providerData: data,
    });
    await this.audit(
      caller,
      await this.userOf(caller),
      "passkey_rename",
      row,
      data.name,
    );
  }

  /**
   * Remove one of the caller's passkeys: proof first, then the last way in
   * is refused.
   */
  public async remove(
    caller: PasskeyCaller,
    id: string,
    proof: PasskeyProof | undefined,
    url: URL,
    cookies?: Cookies,
  ): Promise<void> {
    const settings = await this.settings(caller.realm);
    const rp = this.relyingParty(settings, this.realmName(caller.realm), url);
    const row = await this.ownPasskey(caller, id);
    await this.assertProof(caller, proof, rp, cookies);

    const ways = await this.waysToSignIn(caller.id, caller.realm, rp.rpId);
    const others = ways.filter((it) => it.id !== row.id);
    if (others.length === 0) {
      throw new LastSignInMethodError();
    }

    await this.identities(caller.realm).deleteById(row.id);
    const name = this.dataOf(row).name;
    const user = await this.userOf(caller);
    await this.audit(caller, user, "passkey_remove", row, name);
    await this.notify(caller.realm, user, "removed", name);
  }

  /**
   * Remove a passkey row on an administrator's behalf: no proof and no
   * "last way in" guard, as for every identity an administrator removes.
   * Audited and notified as a removal.
   */
  public async revoke(
    row: IdentityEntity,
    realm: string | undefined,
    actor?: { id: string; email?: string },
  ): Promise<void> {
    await this.identities(realm).deleteById(row.id);
    const name = this.dataOf(row).name;
    const user = await this.realmProvider
      .userRepository(realm)
      .findById(row.userId);
    await this.audit(
      { id: row.userId, realm },
      user ?? undefined,
      "passkey_remove",
      row,
      name,
      actor,
    );
    if (user) {
      await this.notify(realm, user, "removed", name);
    }
  }

  /**
   * Options for the step-up assertion that proves an add or a removal on an
   * account with no password: the account's usable passkeys, user
   * verification required, and the `proof` challenge cookie.
   */
  public async proofOptions(
    caller: PasskeyCaller,
    url: URL,
    cookies?: Cookies,
  ): Promise<AuthenticationOptionsJson> {
    const settings = await this.settings(caller.realm);
    const rp = this.relyingParty(settings, this.realmName(caller.realm), url);
    const usable = (await this.passkeysOf(caller.id, caller.realm)).filter(
      (row) => this.isUsable(row, settings, rp.rpId),
    );
    if (usable.length === 0) {
      throw new PasskeyAssertionProofError({ reason: "missing" });
    }
    const challenge = this.newChallenge();
    this.proofChallenge.set(
      { challenge, ceremony: "proof", userId: caller.id, realm: caller.realm },
      { cookies },
    );
    return {
      challenge,
      rpId: rp.rpId,
      timeout: 300_000,
      allowCredentials: usable.map((row) => ({
        type: "public-key" as const,
        id: row.providerUserId!,
        transports: this.dataOf(row).transports,
      })),
      userVerification: "required",
    };
  }

  /**
   * Sign-in options per IP: looser than the password budget, since asking
   * writes nothing, but bounded.
   */
  protected readonly signInOptionsLimit = $rateLimit({
    name: "passkey:options",
    limit: 60,
    window: [1, "minutes"],
  });

  /**
   * Assertion options for `/_auth/passkey/options`. With no `userId`,
   * `allowCredentials` is empty and the answer depends on no account; with
   * one, they list that user's usable passkeys.
   */
  public async signInOptions(
    realm: string | undefined,
    url: URL,
    context: { userId?: string; requireUserVerification?: boolean } = {},
  ): Promise<AuthenticationOptionsJson> {
    const request = this.alepha.store.get("alepha.http.request");
    const limited = await this.signInOptionsLimit.consume(
      request?.ip ?? "unknown",
    );
    if (!limited.allowed) {
      throw new TooManyRequestsError("Too many passkey sign-in attempts");
    }
    const settings = await this.assertEnabled(realm);
    const rp = this.relyingParty(settings, this.realmName(realm), url);
    const allowCredentials = context.userId
      ? (await this.passkeysOf(context.userId, realm))
          .filter((row) => this.isUsable(row, settings, rp.rpId))
          .map((row) => ({
            type: "public-key" as const,
            id: row.providerUserId!,
            transports: this.dataOf(row).transports,
          }))
      : [];
    return {
      challenge: this.newChallenge(),
      rpId: rp.rpId,
      timeout: 300_000,
      allowCredentials,
      userVerification: context.requireUserVerification
        ? "required"
        : "preferred",
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Verify an assertion against the passkey it names, and record its use.
   *
   * Finds the identity by credential id, checks its owner belongs to the
   * realm (and is `userId` when given), verifies the assertion with the
   * stored key and counter, then writes `signCount`, `lastUsedAt` and
   * `backedUp` with `Repository.save`, under the row's version: of two
   * racing assertions, the second is refused with `DbVersionMismatchError`.
   *
   * Every refusal throws. The sign-in routes turn all of them into one
   * generic error; the step-up proof into its own.
   */
  public async authenticate(
    credential: AuthenticationResponseJson,
    expected: {
      realm?: string;
      challenge: string;
      rp: PasskeyRelyingParty;
      requireUserVerification?: boolean;
      userId?: string;
    },
  ): Promise<{
    identity: IdentityEntity;
    user: UserEntity;
    userVerified: boolean;
  }> {
    const identity = await this.identities(expected.realm).findOne({
      where: {
        provider: { eq: this.provider },
        providerUserId: { eq: credential.id },
      },
    });
    if (!identity) {
      throw new WebAuthnError(
        { reason: "credential" },
        { message: "Unknown passkey" },
      );
    }
    if (expected.userId && identity.userId !== expected.userId) {
      throw new WebAuthnError(
        { reason: "credential" },
        { message: "Passkey of another account" },
      );
    }
    const realm = this.realmProvider.getRealm(expected.realm);
    const user = await this.realmProvider
      .userRepository(expected.realm)
      .findOne({
        where: { id: { eq: identity.userId }, realm: { eq: realm.name } },
      });
    if (!user) {
      throw new WebAuthnError(
        { reason: "credential" },
        { message: "Passkey of another realm" },
      );
    }

    const data = this.dataOf(identity);
    if (data.rpId !== expected.rp.rpId) {
      throw new WebAuthnError(
        { reason: "rpId" },
        { message: "Passkey made for another host" },
      );
    }
    const verified = await this.verifier.verifyAssertion(credential, {
      challenge: expected.challenge,
      rpId: expected.rp.rpId,
      origin: expected.rp.origin,
      requireUserVerification: expected.requireUserVerification,
      publicKey: data.publicKey as WebAuthnPublicKeyJwk,
      signCount: data.signCount,
    });

    await this.identities(expected.realm).save({
      ...identity,
      providerData: {
        ...data,
        signCount: verified.signCount,
        backedUp: verified.backedUp,
        lastUsedAt: this.dateTime.nowISOString(),
      } satisfies PasskeyIdentityData,
    });

    return { identity, user, userVerified: verified.userVerified };
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Check the proof a write carries, by what the account holds.
   */
  protected async assertProof(
    caller: PasskeyCaller,
    proof: PasskeyProof | undefined,
    rp: PasskeyRelyingParty,
    cookies?: Cookies,
  ): Promise<void> {
    const kind = await this.proofKind(caller.id, caller.realm, rp.rpId);
    if (kind === "none") {
      return;
    }
    if (kind === "password") {
      if (!proof?.currentPassword) {
        throw new PasskeyPasswordProofError({ reason: "missing" });
      }
      const credentials = await this.identities(caller.realm).findOne({
        where: { userId: { eq: caller.id }, provider: { eq: "credentials" } },
      });
      const ok = await this.crypto.verifyPassword(
        proof.currentPassword,
        credentials!.password!,
      );
      if (!ok) {
        throw new PasskeyPasswordProofError({ reason: "invalid" });
      }
      return;
    }
    if (!proof?.assertion) {
      throw new PasskeyAssertionProofError({ reason: "missing" });
    }
    let challenge: string;
    try {
      challenge = this.takeChallenge("proof", caller, cookies);
    } catch {
      throw new PasskeyAssertionProofError({ reason: "invalid" });
    }
    try {
      await this.authenticate(proof.assertion, {
        realm: caller.realm,
        challenge,
        rp,
        requireUserVerification: true,
        userId: caller.id,
      });
    } catch (error) {
      this.log.debug("Passkey proof refused", { userId: caller.id, error });
      throw new PasskeyAssertionProofError({ reason: "invalid" });
    }
  }

  /**
   * Read and clear the challenge cookie of a ceremony, bound to the caller.
   */
  protected takeChallenge(
    ceremony: "create" | "proof",
    caller: PasskeyCaller,
    cookies?: Cookies,
  ): string {
    const cookie =
      ceremony === "create" ? this.createChallenge : this.proofChallenge;
    const stored = cookie.get({ cookies });
    if (stored) {
      cookie.del({ cookies });
    }
    if (
      !stored ||
      stored.ceremony !== ceremony ||
      stored.userId !== caller.id ||
      (stored.realm ?? undefined) !== (caller.realm ?? undefined)
    ) {
      throw new PasskeyChallengeError();
    }
    return stored.challenge;
  }

  protected async ownPasskey(
    caller: PasskeyCaller,
    id: string,
  ): Promise<IdentityEntity> {
    // Someone else's id reads as missing, as `unlinkMyIdentity` does.
    const row = await this.identities(caller.realm).findOne({
      where: {
        id: { eq: id },
        userId: { eq: caller.id },
        provider: { eq: this.provider },
      },
    });
    if (!row) {
      throw new NotFoundError("Passkey not found");
    }
    return row;
  }

  protected async assertEnabled(realm?: string): Promise<RealmAuthSettings> {
    const settings = await this.settings(realm);
    if (settings.passkeys !== "optional") {
      throw new PasskeysDisabledError();
    }
    return settings;
  }

  protected assertBelowCap(count: number): void {
    if (count >= this.maxPerUser) {
      throw new PasskeyLimitError({ max: this.maxPerUser });
    }
  }

  protected async settings(realm?: string): Promise<RealmAuthSettings> {
    const settings = await this.realmProvider.getRealm(realm).getSettings();
    // A stored parameter written before passkeys existed has no key.
    return { ...settings, passkeys: settings.passkeys ?? "disabled" };
  }

  protected realmName(realm?: string): string {
    return this.realmProvider.getRealm(realm).name;
  }

  protected async userOf(caller: PasskeyCaller): Promise<UserEntity> {
    const user = await this.realmProvider
      .userRepository(caller.realm)
      .findById(caller.id);
    if (!user) {
      throw new NotFoundError("User not found");
    }
    return user;
  }

  protected identities(realm?: string) {
    return this.realmProvider.identityRepository(realm);
  }

  public dataOf(identity: { providerData?: unknown }): PasskeyIdentityData {
    return identity.providerData as PasskeyIdentityData;
  }

  protected newChallenge(): string {
    return this.base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
  }

  protected cleanName(name: string | undefined): string | undefined {
    const trimmed = name?.trim().slice(0, 64);
    return trimmed || undefined;
  }

  protected async audit(
    caller: PasskeyCaller,
    user: UserEntity | undefined,
    action: "passkey_add" | "passkey_rename" | "passkey_remove",
    identity: IdentityEntity,
    name: string,
    actor?: { id: string; email?: string },
  ): Promise<void> {
    if (!this.alepha.has(UserAudits)) {
      return;
    }
    await this.alepha.inject(UserAudits).user.log(action, {
      resourceType: "user",
      resourceId: caller.id,
      userId: actor?.id ?? caller.id,
      userEmail: actor ? actor.email : (user?.email ?? undefined),
      userRealm: this.realmName(caller.realm),
      description:
        action === "passkey_add"
          ? "Passkey added"
          : action === "passkey_rename"
            ? "Passkey renamed"
            : "Passkey removed",
      // The identity and the name, never the key.
      metadata: { identityId: identity.id, name },
    });
  }

  protected async notify(
    realm: string | undefined,
    user: UserEntity,
    change: "added" | "removed",
    passkeyName: string,
  ): Promise<void> {
    if (
      !user.email ||
      !this.realmProvider.getRealm(realm).features.notifications
    ) {
      return;
    }
    await this.alepha.inject(UserNotifications).passkeyChanged.push({
      contact: user.email,
      variables: { email: user.email, change, passkeyName },
    });
  }
}
