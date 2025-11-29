import { useClient, useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react/auth";
import { useForm } from "@alepha/react/form";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Control, capitalize } from "@alepha/ui";
import { Alert, Card, Flex, Group, PinInput, Stack, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconLock,
  IconMail,
  IconPhone,
  IconUser,
} from "@tabler/icons-react";
import { TypeBoxError, t } from "alepha";
import type {
  RegistrationIntentResponse,
  UserController,
  UserRealmConfig,
} from "alepha/api/users";
import { useMemo, useState } from "react";
import type { AuthI18n } from "../AuthI18n.ts";
import type { AuthRouter } from "../AuthRouter.ts";
import IconGithub from "./icons/IconGithub.tsx";
import IconGoogle from "./icons/IconGoogle.tsx";

export interface RegisterProps {
  realmConfig: UserRealmConfig;
}

type RegistrationPhase = "form" | "verification";

interface RegistrationState {
  phase: RegistrationPhase;
  intent?: RegistrationIntentResponse;
  credentials?: {
    identifier: string;
    password: string;
  };
}

const Register = (props: RegisterProps) => {
  const auth = useAuth();
  const userCtrl = useClient<UserController>();
  const router = useRouter<AuthRouter>();
  const { tr } = useI18n<AuthI18n, "en">();
  const redirect = router.query.redirect || "/";

  const [registrationState, setRegistrationState] = useState<RegistrationState>(
    {
      phase: "form",
    },
  );
  const [emailCode, setEmailCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [verificationError, setVerificationError] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasUsernamePassword = props.realmConfig.authenticationMethods.find(
    (it) => it.type === "CREDENTIALS",
  );

  const settings = props.realmConfig.settings || {};
  const isRegistrationAllowed = settings.registrationAllowed !== false;

  const registerSchema = useMemo(() => {
    const registerSchema = t.object({
      username: t.optional(t.text()),
      email: t.optional(t.email()),
      phoneNumber: t.optional(t.e164()),
      password: t.string({ minLength: 8 }),
      confirmPassword: t.string({ minLength: 8 }),
    });

    const required = registerSchema.required as string[];

    if (settings.usernameRequired) required.push("username");
    if (settings.emailRequired) required.push("email");
    if (settings.phoneRequired) required.push("phoneNumber");

    return registerSchema;
  }, []);

  const form = useForm({
    schema: registerSchema,
    handler: async (data) => {
      if (data.password !== data.confirmPassword) {
        throw new TypeBoxError({
          message: "Passwords do not match",
          instancePath: "/confirmPassword",
          keyword: "not",
          schemaPath: "",
          params: {},
        });
      }

      // Phase 1: Create registration intent
      const intent = await userCtrl.createRegistrationIntent({
        body: {
          username: data.username,
          email: data.email,
          phoneNumber: data.phoneNumber,
          password: data.password,
        },
      });

      const identifier = data.username ?? data.email ?? data.phoneNumber;

      // Check if verification is needed
      if (
        intent.expectEmailVerification ||
        intent.expectPhoneVerification ||
        intent.expectCaptcha
      ) {
        // Move to verification phase
        setRegistrationState({
          phase: "verification",
          intent,
          credentials: identifier
            ? { identifier, password: data.password }
            : undefined,
        });
        return;
      }

      // No verification needed - complete registration immediately
      await userCtrl.createUserFromIntent({
        body: { intentId: intent.intentId },
      });

      // Auto-login after registration
      if (identifier) {
        await auth.login("credentials", {
          username: identifier,
          password: data.password,
        });
      }

      await router.go(router.query.r || "/");
    },
  });

  const handleVerificationSubmit = async () => {
    if (!registrationState.intent) return;

    setIsSubmitting(true);
    setVerificationError(null);

    try {
      // Phase 2: Complete registration with verification codes
      await userCtrl.createUserFromIntent({
        body: {
          intentId: registrationState.intent.intentId,
          emailCode: registrationState.intent.expectEmailVerification
            ? emailCode
            : undefined,
          phoneCode: registrationState.intent.expectPhoneVerification
            ? phoneCode
            : undefined,
        },
      });

      // Auto-login after registration
      if (registrationState.credentials) {
        await auth.login("credentials", {
          username: registrationState.credentials.identifier,
          password: registrationState.credentials.password,
        });
      }

      await router.go(router.query.r || "/");
    } catch (error) {
      setVerificationError(
        error instanceof Error ? error.message : "Verification failed",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmitVerification = () => {
    if (!registrationState.intent) return false;

    if (
      registrationState.intent.expectEmailVerification &&
      emailCode.length !== 6
    ) {
      return false;
    }

    if (
      registrationState.intent.expectPhoneVerification &&
      phoneCode.length !== 6
    ) {
      return false;
    }

    return true;
  };

  // Verification phase UI
  if (registrationState.phase === "verification" && registrationState.intent) {
    return (
      <Flex flex={1} justify={"center"} align={"center"}>
        <Stack gap={"sm"} w={360}>
          <Card withBorder p={"lg"} bg={"var(--alepha-elevated)"}>
            <Stack gap={"md"}>
              <Text size="lg" fw={500} ta="center">
                {tr("registerVerifyTitle") ?? "Verify your account"}
              </Text>
              <Text size="sm" c="dimmed" ta="center">
                {tr("registerVerifyDescription") ??
                  "Please enter the verification code(s) sent to you."}
              </Text>

              {verificationError && (
                <Alert variant="light" color="red" icon={<IconAlertCircle />}>
                  <Text size="sm">{verificationError}</Text>
                </Alert>
              )}

              {registrationState.intent.expectEmailVerification && (
                <Stack gap={"xs"}>
                  <Text size="sm" fw={500}>
                    {tr("registerEmailCode") ?? "Email verification code"}
                  </Text>
                  <Flex justify="center">
                    <PinInput
                      length={6}
                      value={emailCode}
                      onChange={setEmailCode}
                      type="number"
                      oneTimeCode
                      aria-label="Email verification code"
                    />
                  </Flex>
                </Stack>
              )}

              {registrationState.intent.expectPhoneVerification && (
                <Stack gap={"xs"}>
                  <Text size="sm" fw={500}>
                    {tr("registerPhoneCode") ?? "Phone verification code"}
                  </Text>
                  <Flex justify="center">
                    <PinInput
                      length={6}
                      value={phoneCode}
                      onChange={setPhoneCode}
                      type="number"
                      oneTimeCode
                      aria-label="Phone verification code"
                    />
                  </Flex>
                </Stack>
              )}

              <ActionButton
                onClick={handleVerificationSubmit}
                loading={isSubmitting}
                disabled={!canSubmitVerification()}
              >
                {tr("registerVerifySubmit") ?? "Complete Registration"}
              </ActionButton>

              <ActionButton
                variant="subtle"
                onClick={() =>
                  setRegistrationState({ phase: "form", intent: undefined })
                }
              >
                {tr("registerVerifyBack") ?? "Back to registration"}
              </ActionButton>
            </Stack>
          </Card>
        </Stack>
      </Flex>
    );
  }

  // Registration form phase UI
  return (
    <Flex flex={1} justify={"center"} align={"center"}>
      <Stack gap={"sm"} w={360}>
        <Card withBorder p={"lg"} bg={"var(--alepha-elevated)"}>
          <Stack gap={"md"}>
            {!isRegistrationAllowed ? (
              <>
                <Alert
                  variant="light"
                  color="yellow"
                  icon={<IconAlertCircle />}
                >
                  <Text size="sm">{tr("registerDisabled")}</Text>
                </Alert>
                <ActionButton href={router.path("login")}>
                  {tr("registerBackToSignIn")}
                </ActionButton>
              </>
            ) : hasUsernamePassword ? (
              <>
                <form {...form.props}>
                  <Stack flex={1} gap={"md"}>
                    {settings.usernameEnabled !== false &&
                      form.input.username && (
                        <Control
                          title={tr("registerUsername")}
                          input={form.input.username}
                          icon={<IconUser />}
                          text={{
                            autoComplete: "username",
                          }}
                        />
                      )}
                    {settings.emailEnabled !== false && form.input.email && (
                      <Control
                        title={tr("registerEmail")}
                        input={form.input.email}
                        icon={<IconMail />}
                        text={{
                          autoComplete: "email",
                        }}
                      />
                    )}
                    {settings.phoneEnabled === true &&
                      form.input.phoneNumber && (
                        <Control
                          title={tr("registerPhone")}
                          input={form.input.phoneNumber}
                          icon={<IconPhone />}
                          text={{
                            autoComplete: "tel",
                          }}
                        />
                      )}
                    <Control
                      title={tr("registerPassword")}
                      input={form.input.password}
                      icon={<IconLock />}
                      password={{
                        autoComplete: "new-password",
                      }}
                    />
                    <Control
                      title={tr("registerConfirmPassword")}
                      input={form.input.confirmPassword}
                      icon={<IconLock />}
                      password={{
                        autoComplete: "new-password",
                      }}
                    />
                    <ActionButton form={form}>
                      {tr("registerCreateAccount")}
                    </ActionButton>
                  </Stack>
                </form>
                <Group align="center" justify="center" gap={"md"}>
                  <Flex flex={1} h={"1px"} bg={"var(--alepha-text-muted)"} />
                  <Text size="xs">{tr("registerOr")}</Text>
                  <Flex flex={1} h={"1px"} bg={"var(--alepha-text-muted)"} />
                </Group>
              </>
            ) : null}
            {isRegistrationAllowed && (
              <>
                <Stack gap={"sm"}>
                  {props.realmConfig.authenticationMethods.map(
                    (method) =>
                      method.type !== "CREDENTIALS" && (
                        <ActionButton
                          variant={"default"}
                          key={method.type}
                          leftSection={leftSection(method.name.toLowerCase())}
                          onClick={() =>
                            auth.login(method.name, {
                              redirect,
                            })
                          }
                        >
                          {tr("registerContinueWith", {
                            args: [capitalize(method.name)],
                          })}
                        </ActionButton>
                      ),
                  )}
                </Stack>
                {props.realmConfig.authenticationMethods.length > 0 && (
                  <Text size="sm" ta="center">
                    {tr("registerHaveAccount")}{" "}
                    <ActionButton
                      href={router.path("login")}
                      anchorProps={{ inherit: true }}
                    >
                      {tr("registerSignIn")}
                    </ActionButton>
                  </Text>
                )}
              </>
            )}
          </Stack>
        </Card>
        <ActionButton variant={"subtle"} href={redirect}>
          {tr("registerCancel")}
        </ActionButton>
      </Stack>
    </Flex>
  );
};

export default Register;

const leftSection = (name: string) => {
  if (name === "google") {
    return <IconGoogle />;
  }

  if (name === "github") {
    return <IconGithub />;
  }
};
