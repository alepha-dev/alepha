import { ActionButton } from "@alepha/ui";
import { Alert, Card, Flex, Loader, Text } from "@mantine/core";
import { IconAlertCircle, IconCheck, IconMailCheck } from "@tabler/icons-react";
import type { UserController } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { useEffect, useState } from "react";
import type { AuthI18n } from "../AuthI18n.ts";
import type { AuthRouter } from "../AuthRouter.ts";

export type VerifyEmailProps = {};

type Step = "verifying" | "success" | "error";

const VerifyEmail = (_props: VerifyEmailProps) => {
  const router = useRouter<AuthRouter>();
  const state = useRouterState();
  const userCtrl = useClient<UserController>();
  const { tr } = useI18n<AuthI18n, "en">();

  const [step, setStep] = useState<Step>("verifying");
  const [error, setError] = useState<string | null>(null);

  const email = state.query.email as string | undefined;
  const token = state.query.token as string | undefined;

  useEffect(() => {
    const verify = async () => {
      if (!email || !token) {
        setError(tr("verifyEmailMissingParams"));
        setStep("error");
        return;
      }

      try {
        await userCtrl.verifyEmail({
          body: { email, token },
        });
        setStep("success");
      } catch (err) {
        setError(err instanceof Error ? err.message : tr("verifyEmailFailed"));
        setStep("error");
      }
    };

    verify();
  }, [email, token]);

  return (
    <Flex flex={1} justify="center" align="center">
      <Flex direction="column" gap="sm" w={400}>
        <Card withBorder p="lg" bg="var(--alepha-elevated)">
          <Flex direction="column" gap="md" align="center">
            {step === "verifying" && (
              <>
                <Loader size="lg" />
                <Text size="lg" fw={500} ta="center">
                  {tr("verifyEmailVerifying")}
                </Text>
                <Text size="sm" c="dimmed" ta="center">
                  {tr("verifyEmailPleaseWait")}
                </Text>
              </>
            )}

            {step === "success" && (
              <>
                <IconMailCheck size={48} color="var(--mantine-color-green-6)" />
                <Text size="lg" fw={500} ta="center">
                  {tr("verifyEmailTitle")}
                </Text>
                <Alert variant="light" color="green" icon={<IconCheck />}>
                  <Text size="sm">{tr("verifyEmailSuccess")}</Text>
                </Alert>
                <ActionButton href={router.path("login")} fullWidth>
                  {tr("verifyEmailSignIn")}
                </ActionButton>
              </>
            )}

            {step === "error" && (
              <>
                <IconAlertCircle size={48} color="var(--mantine-color-red-6)" />
                <Text size="lg" fw={500} ta="center">
                  {tr("verifyEmailTitle")}
                </Text>
                <Alert variant="light" color="red" icon={<IconAlertCircle />}>
                  <Text size="sm">{error || tr("verifyEmailFailed")}</Text>
                </Alert>
                <ActionButton href={router.path("login")} fullWidth>
                  {tr("verifyEmailBackToSignIn")}
                </ActionButton>
              </>
            )}
          </Flex>
        </Card>
      </Flex>
    </Flex>
  );
};

export default VerifyEmail;
