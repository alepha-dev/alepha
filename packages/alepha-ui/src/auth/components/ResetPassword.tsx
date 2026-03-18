import { ActionButton, Control } from "@alepha/ui";
import { Alert, Card, Flex, Image, PinInput, Text, Title } from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconInfoCircle,
  IconLock,
  IconMail,
} from "@tabler/icons-react";
import { AlephaError, t } from "alepha";
import type {
  PasswordResetIntentResponse,
  RealmConfig,
  UserController,
} from "alepha/api/users";
import { resetPasswordRequestSchema } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import type { AuthI18n } from "../AuthI18n.ts";

export interface ResetPasswordProps {
  realmConfig: RealmConfig;
  loginPath?: string;
}

type Step = "email" | "code" | "password" | "success";

interface ResetState {
  step: Step;
  intent?: PasswordResetIntentResponse;
  email?: string;
  code?: string;
}

const ResetPassword = (props: ResetPasswordProps) => {
  const router = useRouter();
  const userCtrl = useClient<UserController>();
  const { tr } = useI18n<AuthI18n, "en">();
  const [resetState, setResetState] = useState<ResetState>({ step: "email" });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirect = router.query.r || "/";

  const settings = props.realmConfig.settings;
  const isResetPasswordAllowed = settings?.resetPasswordAllowed !== false;

  // Phase 1: Request password reset intent
  const emailForm = useForm({
    schema: resetPasswordRequestSchema,
    handler: async (data) => {
      setError(null);
      const intent = await userCtrl.createPasswordResetIntent({
        query: { userRealmName: props.realmConfig.realmName },
        body: { email: data.email },
      });

      setResetState({
        step: "code",
        intent,
        email: data.email,
      });
    },
  });

  // Phase 2: Complete password reset
  const passwordForm = useForm(
    {
      schema: t.object({
        password: t.string({ minLength: 8 }),
        confirmPassword: t.string({ minLength: 8 }),
      }),
      handler: async (data) => {
        if (data.password !== data.confirmPassword) {
          throw new AlephaError("Passwords do not match");
        }

        if (!resetState.intent || !resetState.code) {
          throw new AlephaError("Invalid reset state");
        }

        await userCtrl.completePasswordReset({
          body: {
            intentId: resetState.intent.intentId,
            code: resetState.code,
            newPassword: data.password,
          },
        });

        setResetState({ step: "success" });
      },
    },
    [resetState.intent, resetState.code],
  );

  const handleCodeComplete = (value: string) => {
    if (value.length === 6) {
      setResetState((prev) => ({
        ...prev,
        step: "password",
        code: value,
      }));
    }
  };

  const handleResendCode = async () => {
    if (!resetState.email) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const intent = await userCtrl.createPasswordResetIntent({
        query: { userRealmName: props.realmConfig.realmName },
        body: { email: resetState.email },
      });

      setResetState((prev) => ({
        ...prev,
        intent,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Flex flex={1} justify={"center"} align={"center"}>
      <Flex direction="column" gap={"sm"} w={360}>
        <Card withBorder p={"lg"} bg={"var(--alepha-elevated)"}>
          <Flex direction="column" gap={"md"}>
            {/* Realm branding */}
            {(settings.logoUrl ||
              settings.displayName ||
              settings.description) && (
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

            {error && (
              <Alert variant="light" color="red" icon={<IconAlertCircle />}>
                <Text size="sm">{error}</Text>
              </Alert>
            )}

            {!isResetPasswordAllowed ? (
              <>
                <Alert
                  variant="light"
                  color="yellow"
                  icon={<IconAlertCircle />}
                >
                  <Text size="sm">{tr("resetPasswordDisabled")}</Text>
                </Alert>
                <ActionButton
                  href={`${props.loginPath ?? "/auth/login"}${props.realmConfig.realmName ? `?realm=${encodeURIComponent(props.realmConfig.realmName)}` : ""}`}
                >
                  {tr("resetPasswordBackToSignIn")}
                </ActionButton>
              </>
            ) : resetState.step === "email" ? (
              <form {...emailForm.props}>
                <Flex direction="column" flex={1} gap={"md"}>
                  <Text size="lg" fw={500} ta="center">
                    {tr("resetPasswordTitle")}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {tr("resetPasswordEnterEmail")}
                  </Text>
                  <Control
                    label={tr("resetPasswordEmail")}
                    input={emailForm.input.email}
                    icon={<IconMail />}
                    text={{
                      autoComplete: "email",
                      autoFocus: true,
                      disabled: !isResetPasswordAllowed,
                    }}
                  />
                  <ActionButton
                    form={emailForm}
                    disabled={!isResetPasswordAllowed}
                  >
                    {tr("resetPasswordSendCode")}
                  </ActionButton>
                </Flex>
              </form>
            ) : resetState.step === "code" ? (
              <Flex direction="column" gap={"md"}>
                <Text size="lg" fw={500} ta="center">
                  {tr("resetPasswordTitle")}
                </Text>
                <Alert variant="light" color="blue" icon={<IconInfoCircle />}>
                  <Text size="sm">{tr("resetPasswordCodeSent")}</Text>
                </Alert>
                <Text size="sm" c="dimmed" ta="center">
                  {tr("resetPasswordEnterCode")}
                </Text>
                <Flex justify="center">
                  <PinInput
                    length={6}
                    type="number"
                    autoFocus
                    oneTimeCode
                    onComplete={handleCodeComplete}
                    aria-label="Password reset verification code"
                  />
                </Flex>
                <ActionButton
                  variant="subtle"
                  onClick={handleResendCode}
                  loading={isSubmitting}
                >
                  {tr("resetPasswordResendCode")}
                </ActionButton>
              </Flex>
            ) : resetState.step === "password" ? (
              <form {...passwordForm.props}>
                <Flex direction="column" flex={1} gap={"md"}>
                  <Text size="lg" fw={500} ta="center">
                    {tr("resetPasswordTitle")}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {tr("resetPasswordEnterNewPassword")}
                  </Text>
                  <Control
                    label={tr("resetPasswordNewPassword")}
                    input={passwordForm.input.password}
                    icon={<IconLock />}
                    password={{
                      autoComplete: "new-password",
                      autoFocus: true,
                    }}
                  />
                  <Control
                    label={tr("resetPasswordConfirmPassword")}
                    input={passwordForm.input.confirmPassword}
                    icon={<IconLock />}
                    password={{
                      autoComplete: "new-password",
                    }}
                  />
                  <ActionButton form={passwordForm}>
                    {tr("resetPasswordSetNewPassword")}
                  </ActionButton>
                </Flex>
              </form>
            ) : (
              <>
                <Alert variant="light" color="green" icon={<IconCheck />}>
                  <Text size="sm">{tr("resetPasswordSuccess")}</Text>
                </Alert>
                <ActionButton
                  href={`${props.loginPath ?? "/auth/login"}${props.realmConfig.realmName ? `?realm=${encodeURIComponent(props.realmConfig.realmName)}` : ""}`}
                >
                  {tr("resetPasswordBackToSignIn")}
                </ActionButton>
              </>
            )}
          </Flex>
        </Card>
        <ActionButton variant={"subtle"} href={redirect}>
          {tr("resetPasswordCancel")}
        </ActionButton>
      </Flex>
    </Flex>
  );
};

export default ResetPassword;
