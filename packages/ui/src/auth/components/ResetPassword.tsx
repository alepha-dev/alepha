import { useRouter } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import { useI18n } from "@alepha/react/i18n";
import { Alert, Card, Flex, PinInput, Stack, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconInfoCircle,
  IconLock,
  IconMail,
} from "@tabler/icons-react";
import { t } from "alepha";
import type { UserRealmConfig } from "alepha/api/users";
import { resetPasswordRequestSchema } from "alepha/api/users";
import { useState } from "react";
import { ActionButton, Control } from "../../core";
import type { AuthI18n } from "../AuthI18n";
import type { AuthRouter } from "../AuthRouter";

export interface ResetPasswordProps {
  realmConfig: UserRealmConfig;
}

type Step = "email" | "code" | "password" | "success";

const ResetPassword = (props: ResetPasswordProps) => {
  const router = useRouter<AuthRouter>();
  const { tr } = useI18n<AuthI18n, "en">();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const redirect = router.query.redirect || "/";

  const isResetPasswordAllowed =
    props.realmConfig.settings?.resetPasswordAllowed !== false;

  const emailForm = useForm({
    schema: resetPasswordRequestSchema,
    handler: async (data) => {
      // UI only - no API call
      setEmail(data.email);
      setStep("code");
    },
  });

  const passwordForm = useForm({
    schema: t.object({
      password: t.string({ minLength: 8 }),
      confirmPassword: t.string({ minLength: 8 }),
    }),
    handler: async (data) => {
      if (data.password !== data.confirmPassword) {
        throw new Error("Passwords do not match");
      }
      // UI only - no API call
      setStep("success");
    },
  });

  const handleCodeComplete = (value: string) => {
    setCode(value);
    if (value.length === 6) {
      setStep("password");
    }
  };

  return (
    <Flex flex={1} justify={"center"} align={"center"}>
      <Stack gap={"sm"} w={360}>
        <Card withBorder p={"lg"} bg={"var(--alepha-elevated)"}>
          <Stack gap={"md"}>
            {!isResetPasswordAllowed ? (
              <>
                <Alert
                  variant="light"
                  color="yellow"
                  icon={<IconAlertCircle />}
                >
                  <Text size="sm">{tr("resetPasswordDisabled")}</Text>
                </Alert>
                <ActionButton href={router.path("login")}>
                  {tr("resetPasswordBackToSignIn")}
                </ActionButton>
              </>
            ) : step === "email" ? (
              <form {...emailForm.props}>
                <Stack flex={1} gap={"md"}>
                  <Text size="sm" c="dimmed">
                    {tr("resetPasswordEnterEmail")}
                  </Text>
                  <Control
                    title={tr("resetPasswordEmail")}
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
                </Stack>
              </form>
            ) : step === "code" ? (
              <Stack gap={"md"}>
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
                    onComplete={handleCodeComplete}
                  />
                </Flex>
                <ActionButton variant="subtle" onClick={() => setStep("email")}>
                  {tr("resetPasswordResendCode")}
                </ActionButton>
              </Stack>
            ) : step === "password" ? (
              <form {...passwordForm.props}>
                <Stack flex={1} gap={"md"}>
                  <Text size="sm" c="dimmed">
                    {tr("resetPasswordEnterNewPassword")}
                  </Text>
                  <Control
                    title={tr("resetPasswordNewPassword")}
                    input={passwordForm.input.password}
                    icon={<IconLock />}
                    password={{
                      autoComplete: "new-password",
                      autoFocus: true,
                    }}
                  />
                  <Control
                    title={tr("resetPasswordConfirmPassword")}
                    input={passwordForm.input.confirmPassword}
                    icon={<IconLock />}
                    password={{
                      autoComplete: "new-password",
                    }}
                  />
                  <ActionButton form={passwordForm}>
                    {tr("resetPasswordSetNewPassword")}
                  </ActionButton>
                </Stack>
              </form>
            ) : (
              <>
                <Alert variant="light" color="green" icon={<IconCheck />}>
                  <Text size="sm">{tr("resetPasswordSuccess")}</Text>
                </Alert>
                <ActionButton href={router.path("login")}>
                  {tr("resetPasswordBackToSignIn")}
                </ActionButton>
              </>
            )}
          </Stack>
        </Card>
        <ActionButton variant={"subtle"} href={redirect}>
          {tr("resetPasswordCancel")}
        </ActionButton>
      </Stack>
    </Flex>
  );
};

export default ResetPassword;
