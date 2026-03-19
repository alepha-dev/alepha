import { randomUUID } from "node:crypto";
import { $inject, Alepha, AlephaError } from "alepha";
import type { VerificationController } from "alepha/api/verifications";
import { $cache } from "alepha/cache";
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

export class RegistrationService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly cryptoProvider = $inject(CryptoProvider);
  protected readonly verificationController = $client<VerificationController>();
  protected readonly realmProvider = $inject(RealmProvider);

  protected readonly intentCache = $cache<RegistrationIntent>({
    name: "api:users:registrations",
    ttl: [INTENT_TTL_MINUTES, "minutes"],
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

    if (body.username) {
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

    // Check for existing users (username, email, phone)
    await this.checkUserAvailability(body, userRealmName);

    // Hash the password
    const passwordHash = await this.cryptoProvider.hashPassword(body.password);

    // Determine requirements based on realm settings
    const requirements = {
      email: realmSettings?.verifyEmailRequired === true && !!body.email,
      phone: realmSettings?.verifyPhoneRequired === true && !!body.phoneNumber,
      captcha: false, // Always false for now
    };

    // Create verification sessions and send codes
    if (requirements.email && body.email) {
      await this.sendEmailVerification(body.email, userRealmName);
    }

    if (requirements.phone && body.phoneNumber) {
      await this.sendPhoneVerification(body.phoneNumber, userRealmName);
    }

    // Generate intent ID and expiration
    const intentId = randomUUID();
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

    // Validate captcha if required (placeholder for future implementation)
    if (intent.requirements.captcha) {
      if (!body.captchaToken) {
        throw new BadRequestError("Captcha verification is required");
      }
      // TODO: Validate captcha token
    }

    // Final availability check (race condition guard)
    await this.checkUserAvailability(
      {
        username: intent.data.username,
        email: intent.data.email,
        phoneNumber: intent.data.phoneNumber,
      },
      userRealmName,
    );

    // Atomically delete cache key to prevent replay
    await this.intentCache.invalidate(body.intentId);

    // Create the user
    const user = await userRepository.create({
      realm: userRealmName,
      username: intent.data.username,
      email: intent.data.email,
      phoneNumber: intent.data.phoneNumber,
      firstName: intent.data.firstName,
      lastName: intent.data.lastName,
      picture: intent.data.picture,
      roles: ["user"],
      enabled: true,
      emailVerified: intent.requirements.email, // Marked as verified if we verified during registration
    });

    // Create credentials identity
    await identityRepository.create({
      userId: user.id,
      provider: "credentials",
      password: intent.data.passwordHash,
    });

    this.log.info("User registered successfully", {
      userId: user.id,
      email: user.email,
      username: user.username,
    });

    const realm = this.realmProvider.getRealm(userRealmName);

    await this.userAudits(userRealmName)?.recordUser("create", {
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
   * Check if username, email, and phone are available.
   */
  protected async checkUserAvailability(
    body: Pick<RegisterRequest, "username" | "email" | "phoneNumber">,
    userRealmName?: string,
  ): Promise<void> {
    const userRepository = this.realmProvider.userRepository(userRealmName);

    if (body.username) {
      const existingUser = await userRepository.findOne({
        where: { username: { eq: body.username } },
      });
      if (existingUser) {
        this.log.debug("Username already taken", { username: body.username });
        throw new ConflictError("User with this username already exists");
      }
    }

    if (body.email) {
      const existingUser = await userRepository.findOne({
        where: { email: { eq: body.email } },
      });
      if (existingUser) {
        this.log.debug("Email already taken", { email: body.email });
        throw new ConflictError("User with this email already exists");
      }
    }

    if (body.phoneNumber) {
      const existingUser = await userRepository.findOne({
        where: { phoneNumber: { eq: body.phoneNumber } },
      });
      if (existingUser) {
        this.log.debug("Phone number already taken", {
          phoneNumber: body.phoneNumber,
        });
        throw new ConflictError("User with this phone number already exists");
      }
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

    const verification =
      await this.verificationController.requestVerificationCode({
        params: { type: "code" },
        body: { target: email },
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
      const verification =
        await this.verificationController.requestVerificationCode({
          params: { type: "code" },
          body: { target: phoneNumber },
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
