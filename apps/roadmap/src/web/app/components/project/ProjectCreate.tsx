import { ActionButton, Control, Flex, Text, useToast } from "@alepha/mantine";
import { Card, Container } from "@mantine/core";
import { IconHammer, IconTag } from "@tabler/icons-react";
import { t } from "alepha";
import { useAlepha, useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useMemo } from "react";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";

const ProjectCreate = () => {
  const client = useClient<ProjectController>();
  const router = useRouter<AppRouter>();
  const auth = useAuth();
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();
  const toast = useToast();

  const initialValues = useMemo(() => {
    try {
      if (router.query.b) {
        return JSON.parse(decodeURIComponent(router.query.b));
      }
    } catch (e) {
      // ignore
    }
  }, [router.query.b]);

  const form = useForm({
    initialValues,
    schema: t.object({
      title: t.string({
        minLength: 3,
        maxLength: 24,
      }),
      public: t.optional(t.boolean()),
    }),
    onError: (error) => {
      toast.danger({ message: error.message });
    },
    handler: async (body) => {
      if (!auth.user) {
        await router.push("login", {
          query: {
            r: router.path("projectCreate", {
              query: {
                b: encodeURIComponent(JSON.stringify(body)),
              },
            }),
          },
        });
        return;
      }

      const project = await client.createProject({ body });

      await router.push("project", {
        params: { projectId: String(project.id) },
      });

      alepha.store.set(userProjectsAtom, [
        ...(alepha.store.get(userProjectsAtom) || []),
        project,
      ]);
    },
  });

  return (
    <Card
      withBorder
      flex={1}
      radius={0}
      p={"sm"}
      bg={theme.colors.panel}
      style={{
        borderLeft: 0,
        borderRight: 0,
      }}
    >
      <Container w={theme.container}>
        <form {...form.props}>
          <Flex direction="column" p={"lg"}>
            <Flex direction="column" gap={0}>
              <Text size="lg" fw={"bold"}>
                {tr("project.create.title")}
              </Text>
              <Text size={"sm"} c={"dimmed"}>
                {tr("project.create.description")}
              </Text>
            </Flex>
            <Card
              withBorder
              radius={"md"}
              p={"sm"}
              bg={theme.colors.card}
              shadow={"md"}
            >
              <Flex
                direction="column"
                p={"sm"}
                style={{ maxWidth: 600 }}
                gap={"xl"}
              >
                <Control
                  input={form.input.title}
                  text={{
                    autoFocus: true,
                  }}
                  icon={<IconTag />}
                  label={tr("project.create.name")}
                  description={tr("project.create.name.helper")}
                />
                <Control
                  input={form.input.public}
                  label={tr("project.create.public")}
                  description={tr("project.create.public.helper")}
                />
                <Flex gap={"md"}>
                  <ActionButton
                    leftSection={<IconHammer />}
                    form={form}
                    variant={"filled"}
                    color={"green"}
                  >
                    {tr("project.create.submit")}
                  </ActionButton>
                </Flex>
              </Flex>
            </Card>
          </Flex>
        </form>
      </Container>
    </Card>
  );
};

export default ProjectCreate;
