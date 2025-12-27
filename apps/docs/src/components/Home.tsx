import { Link } from "@alepha/react";
import {
  Alert,
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
  SegmentedControl,
  SimpleGrid,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBolt,
  IconBook,
  IconBrandGithub,
  IconBrandNpm,
  IconCheck,
  IconCopy,
  IconPlayerPlay,
  IconPuzzle,
  IconRocket,
  IconSparkles,
  IconStack2,
  IconTerminal,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { snippets } from "../config/docs.ts";
import { apiFeatures, coreFeatures } from "../config/features.ts";

const EarlyDevelopmentBanner = () => {
  const [visible, setVisible] = useState(true);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.lg})`);

  if (!visible) return null;

  return (
    <Alert
      icon={<IconAlertTriangle size={18} />}
      color="yellow"
      variant="light"
      withCloseButton
      onClose={() => setVisible(false)}
      style={
        isMobile
          ? {
              margin: 16,
              width: "calc(100% - 32px)",
            }
          : {
              position: "absolute",
              top: 128,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 98,
              maxWidth: "calc(100% - 32px)",
              width: "auto",
            }
      }
    >
      <Text size="sm">
        <Text span fw={600}>
          Early Development
        </Text>
        <Text span>
          {" "}
          Alepha is under active development. API may change. Stable release
          planned for early 2026.
        </Text>
      </Text>
    </Alert>
  );
};

const Home = () => {
  return (
    <Flex
      align={"center"}
      direction={"column"}
      w={"100%"}
      className={"graph-paper"}
    >
      <EarlyDevelopmentBanner />
      <ParticleCanvas />
      <HeroSection />
      <FeatureGrid />
      <InstallSection />
      <FooterCTA />
      <Footer />
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

    const connectParticles = (
      ctx: CanvasRenderingContext2D,
      isDark: boolean,
    ) => {
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
      const isDark =
        document.documentElement.getAttribute("data-mantine-color-scheme") ===
        "dark";

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
      <Title
        order={1}
        style={{
          letterSpacing: "-1.5px",
        }}
        mb="md"
      >
        TypeScript Framework Made Easy
      </Title>

      <Text c="dimmed" size="xl" maw={500} mb="xl">
        Stop gluing libraries together. Alepha gives you APIs, databases,
        queues, React SSR, and more. All type-safe. All works out of the box.
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

const showcaseOptions = [
  { value: "server", label: "Server" },
  { value: "react", label: "React" },
  { value: "db", label: "Database" },
  { value: "queue", label: "Queues" },
  { value: "cli", label: "CLI" },
];

const showcaseSnippets: Record<string, string> = {
  server: snippets.server,
  react: snippets.react,
  db: snippets.db,
  queue: snippets.queue,
  cli: snippets.command,
};

const ShowcaseSection = () => {
  const [active, setActive] = useState("server");

  return (
    <Paper
      withBorder
      visibleFrom={"sm"}
      w={600}
      pos="relative"
      style={{ zIndex: 1 }}
    >
      <Flex direction="column" h={512} w={600}>
        <Box p="xs">
          <SegmentedControl
            value={active}
            onChange={setActive}
            data={showcaseOptions}
            fullWidth
          />
        </Box>
        <CodeSection content={showcaseSnippets[active]} />
      </Flex>
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
    title: "Deploy Anywhere",
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
          The four pillars that guide everything we build.
        </Text>
      </Flex>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
        {principles.map((principle, index) => (
          <Card key={principle.title} padding="xl" radius="md" withBorder>
            <Flex gap="md">
              <ThemeIcon
                color={
                  index === 0
                    ? "grape"
                    : index === 1
                      ? "teal"
                      : index === 2
                        ? "yellow"
                        : "indigo"
                }
                size={44}
                radius="md"
                variant="light"
              >
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

const FeatureCard = (props: {
  feature: (typeof coreFeatures)[number];
}) => {
  const { feature } = props;
  return (
    <Button
      color={"gray"}
      size={"xl"}
      component={Link}
      href={`/docs/${feature.slug}`}
      flex={1}
      px={"xs"}
      variant={"subtle"}
      leftSection={
        <ThemeIcon color={"gray"} variant="light" size={"lg"} radius="md">
          <feature.icon />
        </ThemeIcon>
      }
      justify={"left"}
    >
      <Flex flex={1} ta={"left"} direction={"column"}>
        <Flex align="center" gap="xs">
          <Text>{feature.title}</Text>
          {"new" in feature && feature.new && (
            <Badge
              size="xs"
              variant="light"
              color="teal"
              leftSection={<IconSparkles size={10} />}
            >
              New
            </Badge>
          )}
        </Flex>
        <Text size="xs" c="dimmed">
          {feature.description}
        </Text>
      </Flex>
    </Button>
  );
};

const FeatureGrid = () => (
  <Container size="lg" py={80} w={"100%"}>
    <Flex direction="column" gap={60}>
      <Flex direction="column" gap={"xl"}>
        <Flex w={"100%"} justify="center">
          <Flex direction="column" maw={800} align="center" gap="sm">
            <Title order={2} ta="center">
              Core Packages
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Low-level primitives and building blocks for type-safe
              applications.
            </Text>
          </Flex>
        </Flex>

        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xl">
          {coreFeatures.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </SimpleGrid>
      </Flex>

      <Flex direction="column" gap={"xl"}>
        <Flex w={"100%"} justify="center">
          <Flex direction="column" maw={800} align="center" gap="sm">
            <Title order={2} ta="center">
              Application Modules
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Ready-to-use modules for common application needs.
            </Text>
          </Flex>
        </Flex>

        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xl">
          {apiFeatures.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </SimpleGrid>
      </Flex>
    </Flex>
  </Container>
);

// =============================================================================
// Install Section
// =============================================================================

const InstallSection = () => {
  const installCommand = "npx alepha init";

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
              <Tooltip
                label="Some modules like @alepha/react, @alepha/ui, and cloud storage providers are separate packages, but installed seamlessly by the Alepha CLI."
                withArrow
                multiline
                w={300}
              >
                <Text span c="dimmed" style={{ cursor: "help" }}>
                  *
                </Text>
              </Tooltip>
            </Text>
          </Flex>

          <Card padding="md" radius="md" withBorder w="100%" maw={400}>
            <Flex align="center" justify="space-between" gap="md">
              <Flex align="center" gap="sm">
                <IconTerminal size={20} color="var(--mantine-color-dimmed)" />
                <Code style={{ background: "transparent" }}>
                  {installCommand}
                </Code>
              </Flex>
              <CopyButton value={installCommand} timeout={2000}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? "Copied!" : "Copy"} withArrow>
                    <Button
                      color={"gray"}
                      variant="subtle"
                      onClick={copy}
                      px="xs"
                    >
                      {copied ? (
                        <IconCheck size={16} />
                      ) : (
                        <IconCopy size={16} />
                      )}
                    </Button>
                  </Tooltip>
                )}
              </CopyButton>
            </Flex>
          </Card>

          <Group gap="xs">
            <Button
              color={"gray"}
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
              color={"gray"}
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
            <Text c="dimmed">Join developers who ship faster with Alepha.</Text>
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

// =============================================================================
// Footer
// =============================================================================

const Footer = () => (
  <Box py={40} w="100%">
    <Container size="lg">
      <Flex
        direction={{ base: "column", sm: "row" }}
        justify="space-between"
        align="center"
        gap="md"
      >
        <Flex align="center" gap="xs">
          <Text size="sm" c="dimmed">
            MIT License
          </Text>
          <Text size="sm" c="dimmed">
            ·
          </Text>
          <Text
            size="sm"
            c="dimmed"
            component="a"
            href="https://github.com/feunard/alepha"
            target="_blank"
          >
            GitHub
          </Text>
          <Text size="sm" c="dimmed">
            ·
          </Text>
          <Text
            size="sm"
            c="dimmed"
            component="a"
            href="https://www.npmjs.com/package/alepha"
            target="_blank"
          >
            npm
          </Text>
        </Flex>
        <Flex direction={"column"} align="center" gap="sm">
          <Text size="sm" c="dimmed">
            Made in Paris, France
          </Text>
          <Flex
            style={{
              width: 96,
              height: 2,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <Box style={{ flex: 1, background: "#002395" }} />
            <Box style={{ flex: 1, background: "#ffffff" }} />
            <Box style={{ flex: 1, background: "#ED2939" }} />
          </Flex>
        </Flex>
      </Flex>
    </Container>
  </Box>
);
