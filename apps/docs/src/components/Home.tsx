import { Link } from "@alepha/react";
import {
  Badge,
  Box,
  Button,
  Card,
  Code,
  Container,
  CopyButton,
  Flex,
  Group,
  Paper,
  SimpleGrid,
  Tabs,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBolt,
  IconBook,
  IconBrandGithub,
  IconBrandNpm,
  IconBrandReact,
  IconCheck,
  IconCopy,
  IconDatabase,
  IconMessage2,
  IconPlayerPlay,
  IconPuzzle,
  IconRocket,
  IconServer,
  IconSparkles,
  IconStack2,
  IconTerminal,
  IconTools,
} from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { snippets } from "../config/docs.ts";
import { features } from "../config/features.ts";

const Home = () => {
  return (
    <Flex align={"center"} direction={"column"} w={"100%"} className={"graph-paper"}>
      <ParticleCanvas />
      <HeroSection />
      <PrinciplesSection />
      <FeatureGrid />
      <InstallSection />
      <FooterCTA />
    </Flex>
  );
};

// =============================================================================
// Particle Network Background
// =============================================================================

const ParticleCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let particles: Particle[] = [];
    const mouse = { x: 0, y: 0 };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight * 3;
    };

    class Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      opacity: number;

      constructor(width: number, height: number) {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = (Math.random() - 0.5) * 0.3;
        this.radius = Math.random() * 1.5 + 0.5;
        this.opacity = Math.random() * 0.5 + 0.1;
      }

      update(width: number, height: number) {
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0 || this.x > width) this.vx *= -1;
        if (this.y < 0 || this.y > height) this.vy *= -1;
      }

      draw(ctx: CanvasRenderingContext2D, isDark: boolean) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = isDark
          ? `rgba(255, 255, 255, ${this.opacity})`
          : `rgba(0, 0, 0, ${this.opacity * 0.5})`;
        ctx.fill();
      }
    }

    const init = () => {
      resize();
      particles = [];
      const particleCount = Math.floor((canvas.width * canvas.height) / 15000);
      for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle(canvas.width, canvas.height));
      }
    };

    const connectParticles = (ctx: CanvasRenderingContext2D, isDark: boolean) => {
      const maxDistance = 120;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < maxDistance) {
            const opacity = (1 - distance / maxDistance) * 0.15;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = isDark
              ? `rgba(255, 255, 255, ${opacity})`
              : `rgba(0, 0, 0, ${opacity * 0.5})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
    };

    const animate = () => {
      const isDark = document.documentElement.getAttribute("data-mantine-color-scheme") === "dark";

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((particle) => {
        particle.update(canvas.width, canvas.height);
        particle.draw(ctx, isDark);
      });

      connectParticles(ctx, isDark);
      animationId = requestAnimationFrame(animate);
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };

    window.addEventListener("resize", init);
    window.addEventListener("mousemove", handleMouseMove);

    init();
    animate();

    return () => {
      window.removeEventListener("resize", init);
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "300vh",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
};

export default Home;

// =============================================================================
// Hero Section
// =============================================================================

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
      <Badge size="lg" variant="light" mb="md" leftSection={<IconSparkles size={14} />}>
        v0.13 — Now with Multi-Realm Auth
      </Badge>

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
          href="/docs/guides-introduction"
        >
          Get Started
        </Button>
        <Button
          variant="default"
          size="lg"
          radius="xl"
          leftSection={<IconBook size={20} />}
          component={Link}
          href="/docs/packages-alepha-core"
        >
          Explore Packages
        </Button>
      </Group>
    </Flex>
  );
};

const ShowcaseSection = () => {
  return (
    <Paper withBorder visibleFrom={"sm"} w={640}>
      <Tabs defaultValue="server" variant={"pills"} h={512} w={640}>
        <Tabs.List grow p={"xs"}>
          <Tabs.Tab value="server" leftSection={<IconServer size={16} />}>
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
    // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted content
    dangerouslySetInnerHTML={{ __html: props.content }}
  />
);

// =============================================================================
// Principles Section
// =============================================================================

const principles = [
  {
    icon: IconPuzzle,
    title: "Primitives, Not Magic",
    description:
      "No decorators, no file-system conventions. Just simple factory functions ($action, $entity, $queue) that live in your code.",
  },
  {
    icon: IconStack2,
    title: "Single Source of Truth",
    description:
      "Define your schema once with TypeBox. It powers your database, API validation, and frontend types automatically.",
  },
  {
    icon: IconBolt,
    title: "Zero Boilerplate",
    description:
      "Auto-registration of modules, automatic OpenAPI docs, built-in admin panels. Focus on your business logic.",
  },
  {
    icon: IconRocket,
    title: "Production Ready",
    description:
      "Compiles to optimized bundles. Deploy anywhere: Vercel, Docker, Cloudflare, or a simple VPS.",
  },
];

const PrinciplesSection = () => (
  <Box py={80}>
    <Container size="lg">
      <Flex direction="column" align="center" mb="xl">
        <Title order={2} ta="center" mb="sm">
          The Alepha Philosophy
        </Title>
        <Text size="lg" c="dimmed" maw={600} ta="center">
          We believe frameworks should accelerate you, not constrain you.
        </Text>
      </Flex>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
        {principles.map((principle) => (
          <Card key={principle.title} padding="xl" radius="md" withBorder>
            <Flex gap="md">
              <ThemeIcon size={44} radius="md" variant="light">
                <principle.icon size={22} />
              </ThemeIcon>
              <Flex direction="column" gap={4}>
                <Text fw={600} size="lg">
                  {principle.title}
                </Text>
                <Text size="sm" c="dimmed">
                  {principle.description}
                </Text>
              </Flex>
            </Flex>
          </Card>
        ))}
      </SimpleGrid>
    </Container>
  </Box>
);

// =============================================================================
// Feature Grid
// =============================================================================

const FeatureGrid = () => (
  <Container size="lg" py={80} w={"100%"}>
    <Flex direction="column" gap={"xl"}>
      <Flex w={"100%"} justify="center">
        <Flex direction="column" maw={800} align="center" gap="sm">
          <Title order={2} ta="center">
            A Complete Toolkit for Modern Applications
          </Title>

          <Text size="sm" c="dimmed" ta="center">
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
            href={`/docs/${feature.slug}`}
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

// =============================================================================
// Install Section
// =============================================================================

const InstallSection = () => {
  const installCommand = "npm install alepha";

  return (
    <Box py={80}>
      <Container size="sm">
        <Flex direction="column" align="center" gap="xl">
          <Flex direction="column" align="center" gap="sm">
            <Title order={2} ta="center">
              Ready to Start?
            </Title>
            <Text size="lg" c="dimmed" ta="center">
              One package. Everything included.
            </Text>
          </Flex>

          <Card padding="md" radius="md" withBorder w="100%" maw={400}>
            <Flex align="center" justify="space-between" gap="md">
              <Flex align="center" gap="sm">
                <IconTerminal size={20} color="var(--mantine-color-dimmed)" />
                <Code style={{ background: "transparent" }}>{installCommand}</Code>
              </Flex>
              <CopyButton value={installCommand} timeout={2000}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? "Copied!" : "Copy"} withArrow>
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      onClick={copy}
                      px="xs"
                    >
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </Button>
                  </Tooltip>
                )}
              </CopyButton>
            </Flex>
          </Card>

          <Group gap="xs">
            <Button
              variant="subtle"
              size="sm"
              leftSection={<IconBrandGithub size={16} />}
              component="a"
              href="https://github.com/feunard/alepha"
              target="_blank"
            >
              GitHub
            </Button>
            <Button
              variant="subtle"
              size="sm"
              leftSection={<IconBrandNpm size={16} />}
              component="a"
              href="https://www.npmjs.com/package/alepha"
              target="_blank"
            >
              npm
            </Button>
          </Group>
        </Flex>
      </Container>
    </Box>
  );
};

// =============================================================================
// Footer CTA
// =============================================================================

const FooterCTA = () => (
  <Box py={80}>
    <Container size="md">
      <Card padding="xl" radius="lg" withBorder>
        <Flex
          direction={{ base: "column", sm: "row" }}
          align="center"
          justify="space-between"
          gap="xl"
        >
          <Flex direction="column" gap="xs">
            <Title order={3}>Start Building Today</Title>
            <Text c="dimmed">
              Join developers who ship faster with Alepha.
            </Text>
          </Flex>
          <Button
            size="lg"
            radius="xl"
            rightSection={<IconArrowRight size={18} />}
            component={Link}
            href="/docs/guides-introduction"
          >
            Read the Docs
          </Button>
        </Flex>
      </Card>
    </Container>
  </Box>
);
