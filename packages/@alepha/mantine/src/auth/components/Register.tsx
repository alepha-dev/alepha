import { ActionButton, Control, capitalize } from "@alepha/mantine";
import { Alert, Card, Flex, Image, PinInput, Text, Title } from "@mantine/core";
import {
  IconAlertCircle,
  IconLock,
  IconMail,
  IconPhone,
  IconPhoto,
  IconUser,
} from "@tabler/icons-react";
import { TypeBoxError, t } from "alepha";
import type {
  RealmConfig,
  RegistrationIntentResponse,
  UserController,
} from "alepha/api/users";
import { useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useMemo, useState } from "react";
import type { AuthI18n } from "../AuthI18n.ts";
import IconGithub from "./icons/IconGithub.tsx";
import IconGoogle from "./icons/IconGoogle.tsx";

export interface RegisterProps {
  realmConfig: RealmConfig;
  loginPath?: string;
  variant?: "card" | "split";
  image?: string;
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
  const router = useRouter();
  const { tr } = useI18n<AuthI18n, "en">();
  const redirect = router.query.r || "/";

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

  const credentialsProvider = props.realmConfig.authenticationMethods.find(
    (it) => it.type === "CREDENTIALS",
  );

  const settings = props.realmConfig.settings || {};
  const isRegistrationAllowed = settings.registrationAllowed !== false;

  const registerSchema = useMemo(() => {
    const registerSchema = t.object({
      username: t.optional(
        t.text({
          trim: true,
          pattern: settings.usernameRegExp,
        }),
      ),
      email: t.optional(t.email()),
      phoneNumber: t.optional(t.e164()),
      password: t.string({ minLength: 8 }),
      confirmPassword: t.string({ minLength: 8 }),
    });

    const required = registerSchema.required as string[];

    if (settings.username === "required") required.push("username");
    if (settings.email === "required") required.push("email");
    if (settings.phoneNumber === "required") required.push("phoneNumber");

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
        query: { userRealmName: props.realmConfig.realmName },
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
      if (identifier && credentialsProvider) {
        await auth.login(credentialsProvider.name, {
          username: identifier,
          password: data.password,
          realm: props.realmConfig.realmName,
        });
      }

      await router.push(router.query.r || "/");
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
      if (registrationState.credentials && credentialsProvider) {
        await auth.login(credentialsProvider.name, {
          username: registrationState.credentials.identifier,
          password: registrationState.credentials.password,
          realm: props.realmConfig.realmName,
        });
      }

      await router.push(router.query.r || "/");
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

  // Verification phase UI (always card layout)
  if (registrationState.phase === "verification" && registrationState.intent) {
    return (
      <Flex flex={1} justify={"center"} align={"center"}>
        <Flex direction="column" gap={"sm"} w={360}>
          <Card withBorder p={"lg"} bg={"var(--alepha-elevated)"}>
            <Flex direction="column" gap={"md"}>
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
                <Flex direction="column" gap={"xs"}>
                  <Text size="sm" fw={500}>
                    {tr("registerEmailCode")}
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
                </Flex>
              )}

              {registrationState.intent.expectPhoneVerification && (
                <Flex direction="column" gap={"xs"}>
                  <Text size="sm" fw={500}>
                    {tr("registerPhoneCode")}
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
                </Flex>
              )}

              <ActionButton
                variant={"filled"}
                onClick={handleVerificationSubmit}
                loading={isSubmitting}
                disabled={!canSubmitVerification()}
              >
                {tr("registerVerifySubmit")}
              </ActionButton>

              <ActionButton
                variant="subtle"
                onClick={() =>
                  setRegistrationState({ phase: "form", intent: undefined })
                }
              >
                {tr("registerVerifyBack") ?? "Back to registration"}
              </ActionButton>
            </Flex>
          </Card>
        </Flex>
      </Flex>
    );
  }

  // External login methods
  const externalMethods = props.realmConfig.authenticationMethods.filter(
    (method) => method.type !== "CREDENTIALS",
  );

  const showOrDivider = credentialsProvider && externalMethods.length > 0;

  const realmQuery = props.realmConfig.realmName
    ? `?realm=${encodeURIComponent(props.realmConfig.realmName)}`
    : "";

  const formContent = (
    <Flex direction="column" gap={"md"}>
      {/* Realm branding */}
      {(settings.logoUrl || settings.displayName || settings.description) && (
        <Flex direction="column" gap={"xs"} align="center" mb="xs">
          {settings.logoUrl && (
            <Image
              src={settings.logoUrl}
              alt={settings.displayName || props.realmConfig.realmName}
              h={48}
              w="auto"
              fit="contain"
            />
          )}
          {settings.displayName && (
            <Title order={4} ta="center">
              {settings.displayName}
            </Title>
          )}
          {settings.description && (
            <Text size="sm" c="dimmed" ta="center">
              {settings.description}
            </Text>
          )}
        </Flex>
      )}

      {!isRegistrationAllowed ? (
        <>
          <Alert variant="light" color="yellow" icon={<IconAlertCircle />}>
            <Text size="sm">{tr("registerDisabled")}</Text>
          </Alert>
          <ActionButton
            href={`${props.loginPath ?? "/auth/login"}${realmQuery}`}
          >
            {tr("registerBackToSignIn")}
          </ActionButton>
        </>
      ) : (
        <>
          {/* Credentials registration form */}
          {credentialsProvider && (
            <form {...form.props}>
              <Flex direction="column" flex={1} gap={"md"}>
                {settings.username !== "none" && form.input.username && (
                  <Control
                    label={tr("registerUsername")}
                    input={form.input.username}
                    icon={<IconUser />}
                    text={{
                      autoComplete: "username",
                    }}
                  />
                )}
                {settings.email !== "none" && form.input.email && (
                  <Control
                    label={tr("registerEmail")}
                    input={form.input.email}
                    icon={<IconMail />}
                    text={{
                      autoComplete: "email",
                    }}
                  />
                )}
                {settings.phoneNumber !== "none" && form.input.phoneNumber && (
                  <Control
                    label={tr("registerPhone")}
                    input={form.input.phoneNumber}
                    icon={<IconPhone />}
                    text={{
                      autoComplete: "tel",
                    }}
                  />
                )}
                <Control
                  label={tr("registerPassword")}
                  input={form.input.password}
                  icon={<IconLock />}
                  password={{
                    autoComplete: "new-password",
                  }}
                />
                <Control
                  label={tr("registerConfirmPassword")}
                  input={form.input.confirmPassword}
                  icon={<IconLock />}
                  password={{
                    autoComplete: "new-password",
                  }}
                />
                <ActionButton form={form} variant={"filled"}>
                  {tr("registerCreateAccount")}
                </ActionButton>
              </Flex>
            </form>
          )}

          {/* OR divider - only when both credentials AND external methods exist */}
          {showOrDivider && (
            <Flex align="center" justify="center" gap={"md"}>
              <Flex flex={1} h={"1px"} bg={"var(--alepha-border)"} />
              <Text size="xs" c="dimmed">
                {tr("registerOr")}
              </Text>
              <Flex flex={1} h={"1px"} bg={"var(--alepha-border)"} />
            </Flex>
          )}

          {/* External login methods */}
          {externalMethods.length > 0 && (
            <Flex direction="column" gap={"sm"}>
              {externalMethods.map((method) => (
                <ActionButton
                  variant={"default"}
                  key={method.type}
                  leftSection={leftSection(method.name.toLowerCase())}
                  onClick={() =>
                    auth.login(method.name, {
                      redirect,
                      realm: props.realmConfig.realmName,
                    })
                  }
                >
                  {tr("registerContinueWith", {
                    args: [capitalize(method.name)],
                  })}
                </ActionButton>
              ))}
            </Flex>
          )}

          {/* Sign in link */}
          <Text size="sm" ta="center">
            {tr("registerHaveAccount")}{" "}
            <ActionButton
              href={`${props.loginPath ?? "/auth/login"}${realmQuery}`}
              anchorProps={{ inherit: true }}
            >
              {tr("registerSignIn")}
            </ActionButton>
          </Text>
        </>
      )}
    </Flex>
  );

  if (props.variant === "split") {
    return (
      <Flex flex={1} justify={"center"} align={"center"}>
        <Card
          withBorder
          p={0}
          w={720}
          bg={"var(--alepha-elevated)"}
          style={{ overflow: "hidden" }}
        >
          <Flex mih={480}>
            {props.image ? (
              <Flex
                flex={1}
                style={{
                  backgroundImage: `url(${props.image})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
            ) : (
              <Flex
                flex={1}
                justify="center"
                align="center"
                bg="var(--mantine-color-gray-light)"
                style={{
                  borderRight: "1px solid var(--mantine-color-default-border)",
                }}
              >
                <Flex
                  justify="center"
                  align="center"
                  w={120}
                  h={80}
                  style={{
                    border: "2px dashed var(--mantine-color-default-border)",
                    borderRadius: "var(--mantine-radius-sm)",
                  }}
                >
                  <IconPhoto size={32} style={{ opacity: 0.3 }} />
                </Flex>
              </Flex>
            )}
            <Flex
              flex={1}
              direction="column"
              gap={"md"}
              p={"xl"}
              justify={"center"}
            >
              {formContent}
              <ActionButton variant={"subtle"} href={redirect}>
                {tr("registerCancel")}
              </ActionButton>
            </Flex>
          </Flex>
        </Card>
      </Flex>
    );
  }

  // Default card variant
  return (
    <Flex flex={1} justify={"center"} align={"center"}>
      <Flex direction="column" gap={"sm"} w={360}>
        <Card withBorder p={"lg"} bg={"var(--alepha-elevated)"}>
          {formContent}
        </Card>
        <ActionButton variant={"subtle"} href={redirect}>
          {tr("registerCancel")}
        </ActionButton>
      </Flex>
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
