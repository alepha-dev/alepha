import { ActionButton, Control, capitalize } from "@alepha/ui";
import { Card, Flex, Image, Text, Title } from "@mantine/core";
import { IconLock, IconUser } from "@tabler/icons-react";
import { AlephaError, t } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import { useAuth } from "alepha/react/auth";
import { FormValidationError, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { useMemo } from "react";
import type { AuthI18n } from "../AuthI18n.ts";
import type { AuthRouter } from "../AuthRouter.ts";
import IconGithub from "./icons/IconGithub.tsx";
import IconGoogle from "./icons/IconGoogle.tsx";

export interface LoginProps {
  realmConfig: RealmConfig;
}

const Login = (props: LoginProps) => {
  const auth = useAuth();
  const router = useRouter<AuthRouter>();
  const { tr } = useI18n<AuthI18n, "en">();
  const redirect = router.query.r || "/";

  const credentialsProvider = props.realmConfig.authenticationMethods.find(
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
      if (!credentialsProvider) {
        throw new AlephaError("Credentials provider not configured");
      }

      try {
        await auth.login(credentialsProvider.name, {
          username: data.identifier,
          password: data.password,
          realm: props.realmConfig.realmName,
        });
        await router.push(router.query.r || "/");
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

  const getAutoCompleteType = () => {
    if (loginMethods.includes("email")) {
      return "email";
    }
    if (loginMethods.includes("username")) {
      return "username";
    }
    if (loginMethods.includes("phone")) {
      return "tel";
    }
    return "username";
  };

  const externalLoginMethods = props.realmConfig.authenticationMethods.filter(
    (method) => method.type !== "CREDENTIALS",
  );

  const showOrDivider = credentialsProvider && externalLoginMethods.length > 0;

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

            {/* Credentials login form */}
            {credentialsProvider && (
              <>
                <form {...form.props}>
                  <Flex direction="column" flex={1} gap={"md"}>
                    <Control
                      title={identifierTitle}
                      input={form.input.identifier}
                      icon={IconUser}
                      text={{
                        autoComplete: getAutoCompleteType(),
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
                  </Flex>
                </form>
                {settings.resetPasswordAllowed && (
                  <Text size="sm" ta="center">
                    <ActionButton
                      href={router.path("resetPassword", {
                        query: { realm: props.realmConfig.realmName },
                      })}
                      anchorProps={{ inherit: true }}
                    >
                      {tr("loginForgotPassword")}
                    </ActionButton>
                  </Text>
                )}
              </>
            )}

            {/* OR divider - only when both credentials AND external methods exist */}
            {showOrDivider && (
              <Flex align="center" justify="center" gap={"md"}>
                <Flex flex={1} h={"1px"} bg={"var(--alepha-border)"} />
                <Text size="xs" c={"dimmed"}>
                  {tr("loginOr")}
                </Text>
                <Flex flex={1} h={"1px"} bg={"var(--alepha-border)"} />
              </Flex>
            )}

            {/* External login methods */}
            {externalLoginMethods.length > 0 && (
              <Flex direction="column" gap={"sm"}>
                {externalLoginMethods.map((method) => (
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
                    {tr("loginContinueWith", {
                      args: [capitalize(method.name)],
                    })}
                  </ActionButton>
                ))}
              </Flex>
            )}

            {/* Registration link */}
            {settings.registrationAllowed && (
              <Text size="sm" ta="center">
                {tr("loginNoAccount")}{" "}
                <ActionButton
                  href={router.path("register", {
                    query: { realm: props.realmConfig.realmName },
                  })}
                  anchorProps={{ inherit: true }}
                >
                  {tr("loginSignUp")}
                </ActionButton>
              </Text>
            )}
          </Flex>
        </Card>
        <ActionButton variant={"subtle"} href={"/"}>
          {tr("loginCancel")}
        </ActionButton>
      </Flex>
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
