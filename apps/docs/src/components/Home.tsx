import { Link } from "@alepha/react";
import {
  Button,
  Container,
  Flex,
  Group,
  Paper,
  SimpleGrid,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconBook,
  IconBrandReact,
  IconDatabase,
  IconMessage2,
  IconPlayerPlay,
  IconServer,
  IconTools,
} from "@tabler/icons-react";
import { snippets } from "../config/docs.ts";
import { features } from "../config/features.ts";

const Home = () => {
  return (
    <Flex
      align={"center"}
      direction={"column"}
      w={"100%"}
      className={"graph-paper"}
    >
      <HeroSection />
      <FeatureGrid />
    </Flex>
  );
};

export default Home;

const FeatureGrid = () => (
  <Container size="lg" py="xl" w={"100%"}>
    <Flex direction="column" gap={"xl"}>
      <Flex w={"100%"} justify="center">
        <Flex direction="column" maw={800} align="center" gap="sm">
          <Title order={2} ta="center">
            A Complete Toolkit for Modern Applications
          </Title>

          <Text size="sm" c="dimmed">
            Alepha offers a comprehensive suite of 50+ packages designed to
            streamline the development of type-safe applications.
          </Text>
        </Flex>
      </Flex>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xl">
        {features.map((feature) => (
          <Button
            size={"xl"}
            component={Link}
            href={`/docs/alepha-${feature.slug}`}
            flex={1}
            px={"xs"}
            variant={"subtle"}
            leftSection={
              <ThemeIcon variant="light" size={"lg"} radius="md">
                <feature.icon />
              </ThemeIcon>
            }
            justify={"left"}
            key={feature.title}
          >
            <Flex flex={1} ta={"left"} direction={"column"}>
              <Text>{feature.title}</Text>
              <Text size="xs" c="dimmed">
                {feature.description}
              </Text>
            </Flex>
          </Button>
        ))}
      </SimpleGrid>
    </Flex>
  </Container>
);

const HeroSection = () => (
  <Container size="xl" style={{ minHeight: "100vh", display: "flex" }}>
    <Flex direction="column" justify="center">
      <SimpleGrid cols={{ lg: 2 }} spacing={"xl"}>
        <HeroSectionMessage />
        <ShowcaseSection />
      </SimpleGrid>
    </Flex>
  </Container>
);

const HeroSectionMessage = () => {
  return (
    <Flex
      direction="column"
      justify="center"
      align="center"
      style={{ textAlign: "center" }}
    >
      <Title
        order={1}
        style={{
          letterSpacing: "-1.5px",
        }}
        mb="md"
      >
        Build Type-Safe Applications
      </Title>

      <Text c="dimmed" size="xl" maw={500} mb="xl">
        Alepha is a convention-driven TypeScript framework for building robust,
        end-to-end type-safe applications, from serverless APIs to full-stack
        React apps.
      </Text>

      <Group justify={"center"}>
        <Button
          size="lg"
          radius="xl"
          leftSection={<IconPlayerPlay size={20} />}
          component={Link}
          href="/docs/introduction"
        >
          Get Started
        </Button>
        <Button
          variant="default"
          size="lg"
          radius="xl"
          leftSection={<IconBook size={20} />}
          component={Link}
          href="/docs/alepha-core"
        >
          Explore Packages
        </Button>
      </Group>
    </Flex>
  );
};

const ShowcaseSection = () => {
  return (
    <Paper withBorder visibleFrom={"sm"}>
      <Tabs defaultValue="server" variant={"pills"}>
        <Tabs.List grow p={"xs"}>
          <Tabs.Tab
            variant={""}
            value="server"
            leftSection={<IconServer size={16} />}
          >
            Server
          </Tabs.Tab>
          <Tabs.Tab value="react" leftSection={<IconBrandReact size={16} />}>
            React
          </Tabs.Tab>
          <Tabs.Tab value="db" leftSection={<IconDatabase size={16} />}>
            Database
          </Tabs.Tab>
          <Tabs.Tab value="queue" leftSection={<IconMessage2 size={16} />}>
            Queues
          </Tabs.Tab>
          <Tabs.Tab value="cli" leftSection={<IconTools size={16} />}>
            CLI
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="server">
          <CodeSection content={snippets.server} />
        </Tabs.Panel>
        <Tabs.Panel value="react">
          <CodeSection content={snippets.react} />
        </Tabs.Panel>
        <Tabs.Panel value="db">
          <CodeSection content={snippets.db} />
        </Tabs.Panel>
        <Tabs.Panel value="queue">
          <CodeSection content={snippets.queue} />
        </Tabs.Panel>
        <Tabs.Panel value="cli">
          <CodeSection content={snippets.command} />
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
};

const CodeSection = (props: { content: string }) => (
  <div
    // biome-ignore lint/security/noDangerouslySetInnerHtml: _
    dangerouslySetInnerHTML={{ __html: props.content }}
  />
);
