import { useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react/auth";
import { useForm } from "@alepha/react/form";
import { Card, Flex, Group, Stack, Text } from "@mantine/core";
import { IconLock, IconMail } from "@tabler/icons-react";
import { t } from "alepha";
import type { UserRealmConfig } from "alepha/api/users";
import { ActionButton, Control, capitalize } from "../../core";
import IconGithub from "./icons/IconGithub.tsx";
import IconGoogle from "./icons/IconGoogle.tsx";

export interface LoginProps {
  realmConfig: UserRealmConfig;
}

const Login = (props: LoginProps) => {
  const auth = useAuth();
  const router = useRouter();
  const redirect = router.query.redirect || "/";

  const hasUsernamePassword = props.realmConfig.authenticationMethods.find(
    (it) => it.type === "CREDENTIALS",
  );

  const form = useForm({
    schema: t.object({
      username: t.string({
        minLength: 6,
      }),
      password: t.string({
        minLength: 6,
      }),
    }),
    handler: async (data) => {
      await auth.login("usernamePassword", data);
      await router.go(router.query.r || "/");
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
                      input={form.input.username}
                      icon={<IconMail />}
                      text={{
                        autoComplete: "username",
                      }}
                    />
                    <Control
                      input={form.input.password}
                      icon={<IconLock />}
                      password={{
                        autoComplete: "current-password",
                      }}
                    />
                    <ActionButton form={form}>Sign in</ActionButton>
                  </Stack>
                </form>
                <Group align="center" justify="center" gap={"md"}>
                  <Flex flex={1} h={"1px"} bg={"var(--alepha-text-muted)"} />
                  <Text size="xs">OR</Text>
                  <Flex flex={1} h={"1px"} bg={"var(--alepha-text-muted)"} />
                </Group>
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
                      {`Continue with ${capitalize(method.name)}`}
                    </ActionButton>
                  ),
              )}
            </Stack>
          </Stack>
        </Card>
        <ActionButton variant={"subtle"} href={redirect}>
          Cancel
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
