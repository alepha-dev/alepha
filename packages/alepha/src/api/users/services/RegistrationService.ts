import { $inject, Alepha, AlephaError } from "alepha";
import {
  type VerificationController,
  VerificationService,
} from "alepha/api/verifications";
import { $cache } from "alepha/cache";
import { DatabaseCacheProvider } from "alepha/cache/database";
import { CaptchaProvider } from "alepha/captcha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { CryptoProvider } from "alepha/security";
import { BadRequestError, ConflictError, HttpError } from "alepha/server";
import { $client } from "alepha/server/links";
import { UserAudits } from "../audits/UserAudits.ts";
import type { UserEntity } from "../entities/users.ts";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import type { CompleteRegistrationRequest } from "../schemas/completeRegistrationRequestSchema.ts";
import type { RegisterRequest } from "../schemas/registerRequestSchema.ts";
import type { RegistrationIntentResponse } from "../schemas/registrationIntentResponseSchema.ts";
import { CredentialService } from "./CredentialService.ts";
import { UsernameSlugger } from "./UsernameSlugger.ts";

/**
 * Intent stored in cache during the registration flow.
 */
interface RegistrationIntent {
  data: {
    username?: string;
    email?: string;
    phoneNumber?: string;
    firstName?: string;
    lastName?: string;
    picture?: string;
    passwordHash: string;
  };
  requirements: {
    email: boolean;
    phone: boolean;
    captcha: boolean;
  };
  realmName?: string;
  expiresAt: string;
}

const INTENT_TTL_MINUTES = 10;

/**
 * The single rejection used for every taken identifier — username, email or
 * phone. One message for all three so the response cannot be read as an
 * answer to "does this person have an account here?".
 */
const REGISTRATION_CONFLICT_MESSAGE =
  "These registration details are not available";

export class RegistrationService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly cryptoProvider = $inject(CryptoProvider);
  // Validation goes through the public controller; code *creation* uses the
  // service directly so the raw token is never exposed over HTTP.
  protected readonly verificationController = $client<VerificationController>();
  protected readonly verificationService = $inject(VerificationService);
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly credentialService = $inject(CredentialService);
  protected readonly captchaProvider = $inject(CaptchaProvider);
  protected readonly usernameSlugger = $inject(UsernameSlugger);

  protected readonly intentCache = $cache<RegistrationIntent>({
    // Pinned to the SQL-backed cache so:
    // - phase 2 reliably reads the partial-registration payload phase 1 wrote;
    // - the password hash held in the intent never lives in a distributed
    //   K/V outside the user's own DB unless they explicitly opt in.
    provider: DatabaseCacheProvider,
    name: "api:users:registrations",
    ttl: [INTENT_TTL_MINUTES, "minutes"],
  });

  protected readonly rateLimitCache = $cache<number>({
    // Use the SQL-backed cache so `incr()` is atomic (`INSERT ... ON CONFLICT
    // DO UPDATE SET count = count + 1`). Cloudflare KV silently coalesces
    // concurrent writes to the same key, which makes the limiter useless
    // against bursts.
    provider: DatabaseCacheProvider,
    name: "api:users:registration-rate-limit",
    ttl: [15, "minutes"],
  });

  protected userAudits(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    if (realm.features.audits) {
      return this.alepha.inject(UserAudits);
    }
    return undefined;
  }

  protected userNotifications(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);

    if (realm.features.notifications) {
      return this.alepha.inject(UserNotifications);
    }

    throw new AlephaError(
      `Notifications feature is not enabled for realm "${realmName}". Please enable it in the realm settings to use registration notifications.`,
    );
  }

  /**
   * Phase 1: Create a registration intent.
   *
   * Validates the registration data, checks for existing users,
   * creates verification sessions, and stores the intent in cache.
   */
  public async createRegistrationIntent(
    body: RegisterRequest,
    userRealmName?: string,
  ): Promise<RegistrationIntentResponse> {
    this.log.trace("Creating registration intent", {
      email: body.email,
      username: body.username,
      userRealmName,
    });

    const realm = this.realmProvider.getRealm(userRealmName);
    const realmSettings = await realm.getSettings();

    // IP rate limiting — threshold driven by realm settings so dev/e2e can
    // bump it (a single localhost IP otherwise burns through the default 10
    // before the suite finishes).
    const request = this.alepha.store.get("alepha.http.request");
    const ipKey = request?.ip ? `register:ip:${request.ip}` : undefined;
    if (ipKey) {
      // Atomic incr — a get-then-set counter lets a concurrent burst sail
      // past the threshold (all callers read the same count). The counter
      // expires with the cache TTL (fixed 15-minute window).
      const count = await this.rateLimitCache.incr(ipKey);
      if (count > realmSettings.registrationIpMaxAttempts) {
        this.log.warn("Registration rate limit exceeded", { ip: request?.ip });
        throw new BadRequestError(
          "Too many registration attempts, please try again later",
        );
      }
    }

    // Check if registration is allowed
    if (realmSettings?.registrationAllowed === false) {
      this.log.warn("Registration not allowed for realm", { userRealmName });
      throw new BadRequestError("Registration is not allowed");
    }

    // Validate required fields based on settings
    if (realmSettings?.username === "required" && !body.username) {
      this.log.debug("Registration rejected: username required", {
        userRealmName,
      });
      throw new BadRequestError("Username is required");
    }

    // In "email" mode the server is authoritative — any username sent in
    // the request is dropped on the floor and replaced by the slugger
    // output below.
    if (realmSettings?.username === "email") {
      body.username = undefined;
    }

    if (body.username) {
      // Security note: usernameRegExp is admin-controlled (from realmAuthSettingsAtom),
      // not user input. Default is ^[a-zA-Z0-9_-]{3,30}$ which is ReDoS-safe.
      // No need for regex timeout or safe-regex validation here.
      const usernameRegExp = realmSettings?.usernameRegExp;
      if (usernameRegExp) {
        const regex = new RegExp(usernameRegExp);
        if (!regex.test(body.username)) {
          this.log.debug("Registration rejected: username regex mismatch", {
            userRealmName,
            username: body.username,
          });
          throw new BadRequestError(
            "Username does not meet the required format",
          );
        }
      }

      // Manual usernames must also clear the realm blocklist — same set
      // that the slugger uses, so apps can't be sidestepped by clients
      // POSTing the reserved name directly.
      if (await this.usernameSlugger.isBlocked(userRealmName, body.username)) {
        this.log.debug("Registration rejected: username is blocked", {
          userRealmName,
          username: body.username,
        });
        throw new BadRequestError("This username is not available");
      }
    }

    if (realmSettings?.email === "required" && !body.email) {
      this.log.debug("Registration rejected: email required", {
        userRealmName,
      });
      throw new BadRequestError("Email is required");
    }

    if (realmSettings?.phoneNumber === "required" && !body.phoneNumber) {
      this.log.debug("Registration rejected: phone required", {
        userRealmName,
      });
      throw new BadRequestError("Phone number is required");
    }

    if (
      realmSettings?.firstNameLastName === "required" &&
      (!body.firstName?.trim() || !body.lastName?.trim())
    ) {
      this.log.debug("Registration rejected: first/last name required", {
        userRealmName,
      });
      throw new BadRequestError("First name and last name are required");
    }

    // Validate captcha BEFORE the availability checks and any side effects
    // (email sends). Checking availability first would let bots enumerate
    // registered emails/usernames/phones without ever solving a captcha.
    if (realmSettings?.captchaRequired === true) {
      if (!body.captchaToken) {
        throw new BadRequestError("Captcha verification is required");
      }
      const valid = await this.captchaProvider.verify(body.captchaToken);
      if (!valid) {
        throw new BadRequestError("Captcha verification failed");
      }
    }

    // In "email" mode, derive the username from the email *now* so that
    // checkUserAvailability picks it up too, the DB unique index sees a
    // concrete value, and the persisted intent already carries the final
    // username.
    if (realmSettings?.username === "email") {
      if (!body.email) {
        throw new BadRequestError(
          "Email is required to derive a username from email",
        );
      }
      const base = this.usernameSlugger.slug(body.email);
      body.username = await this.usernameSlugger.pickAvailable(
        userRealmName,
        base,
      );
    }

    // Check for existing users (username, email, phone).
    //
    // A taken email is handled differently from the other two when the realm
    // verifies email: instead of rejecting — which confirms the address is
    // registered — the flow continues as if the address were new and mints a
    // decoy intent below. The stranger sees the ordinary "check your inbox"
    // response and cannot tell the two cases apart.
    const conflict = await this.findAvailabilityConflict(body, userRealmName);
    const emailVerificationRequired =
      realmSettings?.verifyEmailRequired === true && !!body.email;
    const decoy = conflict === "email" && emailVerificationRequired;
    if (conflict && !decoy) {
      throw new ConflictError(REGISTRATION_CONFLICT_MESSAGE);
    }

    // Validate password against realm policy
    this.credentialService.validatePasswordPolicy(
      body.password,
      realmSettings.passwordPolicy,
    );

    // Hash the password
    const passwordHash = await this.cryptoProvider.hashPassword(body.password);

    // Determine requirements based on realm settings
    const requirements = {
      email: realmSettings?.verifyEmailRequired === true && !!body.email,
      phone: realmSettings?.verifyPhoneRequired === true && !!body.phoneNumber,
      captcha: false, // validated above, single-use — no gate at complete time
    };

    // Create verification sessions and send codes.
    //
    // On the decoy path we deliberately mint no verification: the address
    // belongs to someone else, and a working code sent to their inbox is a
    // code the stranger might talk them into reading out. The owner gets a
    // warning instead. The intent is still stored with `requirements.email`
    // set, so completing it fails on the code check exactly as a genuine
    // intent with a wrong code does.
    if (requirements.email && body.email) {
      if (decoy) {
        await this.sendRegistrationAttemptWarning(body.email, userRealmName);
      } else {
        await this.sendEmailVerification(body.email, userRealmName);
      }
    }

    if (requirements.phone && body.phoneNumber) {
      await this.sendPhoneVerification(body.phoneNumber, userRealmName);
    }

    // Generate intent ID and expiration
    const intentId = this.cryptoProvider.randomUUID();
    const expiresAt = this.dateTimeProvider
      .now()
      .add(INTENT_TTL_MINUTES, "minutes")
      .toISOString();

    // Store intent in cache
    const intent: RegistrationIntent = {
      data: {
        username: body.username,
        email: body.email,
        phoneNumber: body.phoneNumber,
        firstName: body.firstName,
        lastName: body.lastName,
        picture: body.picture,
        passwordHash,
      },
      requirements,
      realmName: userRealmName,
      expiresAt,
    };

    await this.intentCache.set(intentId, intent);

    this.log.info("Registration intent created", {
      intentId,
      email: body.email,
      username: body.username,
      requiresEmailVerification: requirements.email,
      requiresPhoneVerification: requirements.phone,
    });

    return {
      intentId,
      expectCaptcha: requirements.captcha,
      captchaSiteKey: requirements.captcha
        ? this.captchaProvider.getSiteKey()
        : undefined,
      expectEmailVerification: requirements.email,
      expectPhoneVerification: requirements.phone,
      expiresAt,
    };
  }

  /**
   * Phase 2: Complete registration using an intent.
   *
   * Validates all requirements (verification codes, captcha),
   * creates the user and credentials, and returns the user.
   */
  public async completeRegistration(
    body: CompleteRegistrationRequest,
  ): Promise<UserEntity> {
    this.log.trace("Completing registration", { intentId: body.intentId });

    // Fetch intent from cache
    const intent = await this.intentCache.get(body.intentId);
    if (!intent) {
      this.log.warn("Invalid or expired registration intent", {
        intentId: body.intentId,
      });
      throw new HttpError({
        status: 410,
        message: "Invalid or expired registration intent",
      });
    }

    const userRealmName = intent.realmName;
    const userRepository = this.realmProvider.userRepository(userRealmName);
    const identityRepository =
      this.realmProvider.identityRepository(userRealmName);

    // Validate email verification if required
    if (intent.requirements.email) {
      if (!body.emailCode) {
        this.log.debug("Registration completion missing email code", {
          intentId: body.intentId,
        });
        throw new BadRequestError("Email verification code is required");
      }

      if (!intent.data.email) {
        throw new BadRequestError("Email is missing from registration intent");
      }

      await this.verifyEmailCode(intent.data.email, body.emailCode);
    }

    // Validate phone verification if required
    if (intent.requirements.phone) {
      if (!body.phoneCode) {
        this.log.debug("Registration completion missing phone code", {
          intentId: body.intentId,
        });
        throw new BadRequestError("Phone verification code is required");
      }

      if (!intent.data.phoneNumber) {
        throw new BadRequestError(
          "Phone number is missing from registration intent",
        );
      }

      await this.verifyPhoneCode(intent.data.phoneNumber, body.phoneCode);
    }

    // Captcha is validated at intent creation (see createIntent) so bots can't
    // trigger verification emails; nothing to re-check here.

    // Final availability check (race condition guard)
    await this.checkUserAvailability(
      {
        username: intent.data.username,
        email: intent.data.email,
        phoneNumber: intent.data.phoneNumber,
      },
      userRealmName,
    );

    const realm = this.realmProvider.getRealm(userRealmName);
    const realmSettings = await realm.getSettings();

    // Create the user
    const user = await userRepository.create({
      realm: realm.name,
      username: intent.data.username,
      email: intent.data.email,
      phoneNumber: intent.data.phoneNumber,
      firstName: intent.data.firstName,
      lastName: intent.data.lastName,
      picture: intent.data.picture,
      roles: realmSettings.defaultRoles,
      enabled: true,
      emailVerified: intent.requirements.email, // Marked as verified if we verified during registration
    });

    // Create credentials identity
    await identityRepository.create({
      userId: user.id,
      provider: "credentials",
      password: intent.data.passwordHash,
    });

    // Invalidate intent after both user and identity creation succeed,
    // so the user can retry if either operation fails.
    await this.intentCache.invalidate(body.intentId);

    this.log.info("User registered successfully", {
      userId: user.id,
      email: user.email,
      username: user.username,
    });

    await this.userAudits(userRealmName)?.user.log("create", {
      resourceType: "user",
      userId: user.id,
      userEmail: user.email ?? undefined,
      userRealm: realm.name,
      resourceId: user.id,
      description: "User registered",
      metadata: {
        username: user.username,
        email: user.email,
        emailVerified: user.emailVerified,
        registrationMethod: "credentials",
      },
    });

    return user;
  }

  /**
   * Find the first identifier already on file, without throwing.
   *
   * Returns which field collided so the caller can decide what to do about
   * it — the decision differs by field and by realm settings, and the choice
   * is security-sensitive enough that it does not belong in a lookup.
   */
  protected async findAvailabilityConflict(
    body: Pick<RegisterRequest, "username" | "email" | "phoneNumber">,
    userRealmName?: string,
  ): Promise<"username" | "email" | "phoneNumber" | undefined> {
    const realm = this.realmProvider.getRealm(userRealmName);
    const userRepository = this.realmProvider.userRepository(userRealmName);

    if (body.username) {
      const existingUser = await userRepository.findOne({
        where: {
          realm: realm.name,
          username: { eqInsensitive: body.username },
        },
      });
      if (existingUser) {
        this.log.debug("Username already taken", { username: body.username });
        return "username";
      }
    }

    if (body.email) {
      const existingUser = await userRepository.findOne({
        where: { realm: realm.name, email: { eq: body.email } },
      });
      if (existingUser) {
        this.log.debug("Email already taken", { email: body.email });
        return "email";
      }
    }

    if (body.phoneNumber) {
      const existingUser = await userRepository.findOne({
        where: { realm: realm.name, phoneNumber: { eq: body.phoneNumber } },
      });
      if (existingUser) {
        this.log.debug("Phone number already taken", {
          phoneNumber: body.phoneNumber,
        });
        return "phoneNumber";
      }
    }

    return undefined;
  }

  /**
   * Check if username, email, and phone are available.
   *
   * The rejection is deliberately identical whichever field collided. Naming
   * the field turns this endpoint into an oracle: post a target address and
   * the error tells you whether that person has an account here, which is
   * exactly the list an attacker wants for phishing or credential stuffing.
   * The debug log above still records which field it was, for operators.
   */
  protected async checkUserAvailability(
    body: Pick<RegisterRequest, "username" | "email" | "phoneNumber">,
    userRealmName?: string,
  ): Promise<void> {
    const conflict = await this.findAvailabilityConflict(body, userRealmName);
    if (conflict) {
      throw new ConflictError(REGISTRATION_CONFLICT_MESSAGE);
    }
  }

  /**
   * Warn the owner of an address that someone tried to register with it.
   *
   * Best-effort: a failure here must not change the response the caller
   * sees, or the delivery outcome itself becomes the oracle this whole path
   * exists to close.
   */
  protected async sendRegistrationAttemptWarning(
    email: string,
    realmName?: string,
  ): Promise<void> {
    try {
      await this.userNotifications(realmName).registrationAttempt.push({
        contact: email,
        variables: { email },
      });
    } catch (error) {
      this.log.warn("Failed to send registration attempt warning", { error });
    }
  }

  /**
   * Send email verification code.
   */
  protected async sendEmailVerification(
    email: string,
    realmName?: string,
  ): Promise<void> {
    this.log.debug("Sending email verification code", { email });

    const verification = await this.verificationService.createVerification({
      type: "code",
      target: email,
    });

    await this.userNotifications(realmName).emailVerification.push({
      contact: email,
      variables: {
        email,
        code: verification.token,
        expiresInMinutes: Math.floor(verification.codeExpiration / 60),
      },
    });

    this.log.debug("Email verification code sent", { email });
  }

  /**
   * Send phone verification code.
   */
  protected async sendPhoneVerification(
    phoneNumber: string,
    realmName?: string,
  ): Promise<void> {
    this.log.debug("Sending phone verification code", { phoneNumber });
    try {
      const verification = await this.verificationService.createVerification({
        type: "code",
        target: phoneNumber,
      });

      await this.userNotifications(realmName).phoneVerification.push({
        contact: phoneNumber,
        variables: {
          phoneNumber,
          code: verification.token,
          expiresInMinutes: Math.floor(verification.codeExpiration / 60),
        },
      });
      this.log.debug("Phone verification code sent", { phoneNumber });
    } catch (error) {
      // Silent fail - verification service may have rate limiting
      this.log.warn("Failed to send phone verification code", {
        phoneNumber,
        error,
      });
    }
  }

  /**
   * Verify email code using verification service.
   */
  protected async verifyEmailCode(email: string, code: string): Promise<void> {
    const result = await this.verificationController
      .validateVerificationCode({
        params: { type: "code" },
        body: { target: email, token: code },
      })
      .catch(() => {
        this.log.warn("Invalid email verification code", { email });
        throw new BadRequestError("Invalid or expired email verification code");
      });

    if (result.alreadyVerified) {
      this.log.warn("Email verification code already used", { email });
      throw new BadRequestError(
        "Email verification code has already been used",
      );
    }
  }

  /**
   * Verify phone code using verification service.
   */
  protected async verifyPhoneCode(
    phoneNumber: string,
    code: string,
  ): Promise<void> {
    const result = await this.verificationController
      .validateVerificationCode({
        params: { type: "code" },
        body: { target: phoneNumber, token: code },
      })
      .catch(() => {
        this.log.warn("Invalid phone verification code", { phoneNumber });
        throw new BadRequestError("Invalid or expired phone verification code");
      });

    if (result.alreadyVerified) {
      this.log.warn("Phone verification code already used", { phoneNumber });
      throw new BadRequestError(
        "Phone verification code has already been used",
      );
    }
  }
}
