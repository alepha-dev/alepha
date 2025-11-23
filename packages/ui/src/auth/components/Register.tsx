import { useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react/auth";
import { useForm } from "@alepha/react/form";
import { useI18n } from "@alepha/react/i18n";
import { Alert, Anchor, Card, Flex, Group, Stack, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconLock,
  IconMail,
  IconPhone,
  IconUser,
} from "@tabler/icons-react";
import { t } from "alepha";
import type { UserRealmConfig } from "alepha/api/users";
import { useMemo } from "react";
import { ActionButton, Control, capitalize } from "../../core";
import type { AuthI18n } from "../AuthI18n";
import type { AuthRouter } from "../AuthRouter";
import IconGithub from "./icons/IconGithub.tsx";
import IconGoogle from "./icons/IconGoogle.tsx";

export interface RegisterProps {
  realmConfig: UserRealmConfig;
}

const Register = (props: RegisterProps) => {
  const auth = useAuth();
  const router = useRouter<AuthRouter>();
  const { tr } = useI18n<AuthI18n, "en">();
  const redirect = router.query.redirect || "/";

  const hasUsernamePassword = props.realmConfig.authenticationMethods.find(
    (it) => it.type === "CREDENTIALS",
  );

  const settings = props.realmConfig.settings || {};
  const isRegistrationAllowed = settings.registrationAllowed !== false;

  // Build dynamic schema based on realm settings
  const registerSchema = useMemo(() => {
    const schemaFields: Record<string, any> = {};

    // Username field
    if (settings.usernameEnabled !== false) {
      schemaFields.username =
        settings.usernameRequired !== false
          ? t.string({
              minLength: 3,
              maxLength: 20,
              pattern: /^[a-zA-Z0-9_]+$/,
            })
          : t.optional(
              t.string({
                minLength: 3,
                maxLength: 20,
                pattern: /^[a-zA-Z0-9_]+$/,
              }),
            );
    }

    // Email field
    if (settings.emailEnabled !== false) {
      schemaFields.email =
        settings.emailRequired !== false ? t.email() : t.optional(t.email());
    }

    // Phone field
    if (settings.phoneEnabled === true) {
      schemaFields.phone =
        settings.phoneRequired === true
          ? t.string({
              pattern: /^\+?[1-9]\d{1,14}$/,
            })
          : t.optional(
              t.string({
                pattern: /^\+?[1-9]\d{1,14}$/,
              }),
            );
    }

    // Password fields are always required for registration
    schemaFields.password = t.string({
      minLength: settings.passwordPolicy?.minLength || 8,
    });
    schemaFields.confirmPassword = t.string({
      minLength: settings.passwordPolicy?.minLength || 8,
    });

    return t.object(schemaFields);
  }, [settings]);

  const form = useForm({
    schema: registerSchema,
    handler: async (data: any) => {
      if (data.password !== data.confirmPassword) {
        throw new Error("Passwords do not match");
      }
      // UI only - no API call
      await router.go(router.query.r || "/");
    },
  });

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
                          input={form.input.username as any}
                          icon={<IconUser />}
                          text={{
                            autoComplete: "username",
                          }}
                        />
                      )}
                    {settings.emailEnabled !== false && form.input.email && (
                      <Control
                        title={tr("registerEmail")}
                        input={form.input.email as any}
                        icon={<IconMail />}
                        text={{
                          autoComplete: "email",
                        }}
                      />
                    )}
                    {settings.phoneEnabled === true && form.input.phone && (
                      <Control
                        title={tr("registerPhone")}
                        input={form.input.phone as any}
                        icon={<IconPhone />}
                        text={{
                          autoComplete: "tel",
                        }}
                      />
                    )}
                    <Control
                      title={tr("registerPassword")}
                      input={form.input.password as any}
                      icon={<IconLock />}
                      password={{
                        autoComplete: "new-password",
                      }}
                    />
                    <Control
                      title={tr("registerConfirmPassword")}
                      input={form.input.confirmPassword as any}
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
                    <Anchor href={router.path("login")} inherit>
                      {tr("registerSignIn")}
                    </Anchor>
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
