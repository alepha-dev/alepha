import { useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react/auth";
import { FormValidationError, useForm } from "@alepha/react/form";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Control, capitalize } from "@alepha/ui";
import { Card, Flex, Group, Stack, Text } from "@mantine/core";
import { IconLock, IconUser } from "@tabler/icons-react";
import { t } from "alepha";
import type { UserRealmConfig } from "alepha/api/users";
import { HttpError } from "alepha/server";
import { useMemo } from "react";
import type { AuthI18n } from "../AuthI18n.ts";
import type { AuthRouter } from "../AuthRouter.ts";
import IconGithub from "./icons/IconGithub.tsx";
import IconGoogle from "./icons/IconGoogle.tsx";

export interface LoginProps {
  realmConfig: UserRealmConfig;
}

const Login = (props: LoginProps) => {
  const auth = useAuth();
  const router = useRouter<AuthRouter>();
  const { tr } = useI18n<AuthI18n, "en">();
  const redirect = router.query.r || "/";

  const hasUsernamePassword = props.realmConfig.authenticationMethods.find(
    (it) => it.type === "CREDENTIALS",
  );

  const settings = props.realmConfig.settings;

  // Determine what login methods are available
  const loginMethods = useMemo(() => {
    const methods = [];
    if (settings.usernameEnabled !== false) methods.push("username");
    if (settings.emailEnabled !== false) methods.push("email");
    if (settings.phoneEnabled === true) methods.push("phone");
    return methods;
  }, [settings]);

  // Create identifier title based on enabled methods
  const identifierTitle = useMemo(() => {
    if (loginMethods.length === 0) return tr("loginUsername");
    if (loginMethods.length === 1) {
      if (loginMethods[0] === "username") return tr("loginUsername");
      if (loginMethods[0] === "email") return tr("loginEmail");
      if (loginMethods[0] === "phone") return tr("loginPhone");
    }
    const labels = loginMethods.map((m) => {
      if (m === "username") return tr("loginUsername").toLowerCase();
      if (m === "email") return tr("loginEmail").toLowerCase();
      if (m === "phone") return tr("loginPhone").toLowerCase();
      return m;
    });
    return capitalize(
      `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`,
    );
  }, [loginMethods, tr]);

  const form = useForm({
    schema: t.object({
      identifier: t.string({
        minLength: 1,
      }),
      password: t.string({
        minLength: settings.passwordPolicy?.minLength || 6,
      }),
    }),
    handler: async (data) => {
      try {
        await auth.login("credentials", {
          username: data.identifier,
          password: data.password,
        });
        await router.go(router.query.r || "/");
      } catch (error) {
        if (
          error instanceof HttpError &&
          error.error === "InvalidCredentialsError"
        ) {
          throw new FormValidationError({
            message: "Invalid identifier or password",
            path: "/password",
          });
        }
        throw error;
      }
    },
  });

  return (
    <Flex flex={1} justify={"center"} align={"center"}>
      <Stack gap={"sm"} w={360}>
        <Card withBorder p={"lg"} bg={"var(--alepha-elevated)"}>
          <Stack gap={"md"}>
            {hasUsernamePassword && (
              <>
                <form {...form.props}>
                  <Stack flex={1} gap={"md"}>
                    <Control
                      title={identifierTitle}
                      input={form.input.identifier}
                      icon={IconUser}
                      text={{
                        autoComplete: loginMethods.includes("email")
                          ? "email"
                          : "username",
                      }}
                    />
                    <Control
                      title={tr("loginPassword")}
                      input={form.input.password}
                      icon={IconLock}
                      password={{
                        autoComplete: "current-password",
                      }}
                    />
                    <ActionButton variant={"filled"} form={form}>
                      {tr("loginSignIn")}
                    </ActionButton>
                  </Stack>
                </form>
                <Stack gap="xs">
                  {settings.resetPasswordAllowed && (
                    <Text size="sm" ta="center">
                      <ActionButton
                        href={router.path("resetPassword")}
                        anchorProps={{ inherit: true }}
                      >
                        {tr("loginForgotPassword")}
                      </ActionButton>
                    </Text>
                  )}
                  <Group align="center" justify="center" gap={"md"}>
                    <Flex flex={1} h={"1px"} bg={"var(--alepha-text-muted)"} />
                    <Text size="xs">{tr("loginOr")}</Text>
                    <Flex flex={1} h={"1px"} bg={"var(--alepha-text-muted)"} />
                  </Group>
                </Stack>
              </>
            )}
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
                      {tr("loginContinueWith", {
                        args: [capitalize(method.name)],
                      })}
                    </ActionButton>
                  ),
              )}
            </Stack>
            <Text size="sm" ta="center">
              {tr("loginNoAccount")}{" "}
              <ActionButton
                href={router.path("register")}
                anchorProps={{ inherit: true }}
              >
                {tr("loginSignUp")}
              </ActionButton>
            </Text>
          </Stack>
        </Card>
        <ActionButton variant={"subtle"} href={redirect}>
          {tr("loginCancel")}
        </ActionButton>
      </Stack>
    </Flex>
  );
};

export default Login;

const leftSection = (name: string) => {
  if (name === "google") {
    return <IconGoogle />;
  }

  if (name === "github") {
    return <IconGithub />;
  }
};
