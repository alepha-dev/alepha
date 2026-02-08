import {
  ActionButton,
  AlephaMantineProvider,
  DarkModeButton,
  Flex,
} from "@alepha/ui";
import { UserButton } from "@alepha/ui/auth";
import { AppShell, Container, createTheme, Text } from "@mantine/core";
import { ClientOnly } from "alepha/react";
import { NestedView, useActive } from "alepha/react/router";

const blogTheme = createTheme({
  primaryColor: "blue",
  fontFamily:
    '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  headings: {
    fontFamily: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
    fontWeight: "700",
  },
  colors: {
    dark: [
      "#e6edf3",
      "#c9d1d9",
      "#8b949e",
      "#656d76",
      "#484f58",
      "#30363d",
      "#21262d",
      "#161b22",
      "#0d1117",
      "#010409",
    ],
  },
  defaultRadius: "xs",
  spacing: {
    xs: "0.5rem",
    sm: "0.75rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2.5rem",
  },
});

function NavLink({ href, children }: { href: string; children: string }) {
  const { isActive } = useActive(href);
  return (
    <ActionButton
      anchorProps={{ underline: "never" }}
      href={href}
      fz="xs"
      fw={500}
      c={isActive ? "var(--blog-text)" : "var(--blog-text-muted)"}
      className="blog-nav-link"
      unstyled
      style={{
        fontFamily: "var(--blog-font-mono)",
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </ActionButton>
  );
}

const BlogLayout = () => {
  return (
    <AlephaMantineProvider
      mantine={{ theme: blogTheme, defaultColorScheme: "auto" }}
    >
      <AppShell
        header={{ height: 56 }}
        padding={0}
        styles={{
          root: {
            backgroundColor: "var(--blog-bg)",
            minHeight: "100vh",
          },
          main: {
            backgroundColor: "var(--blog-bg)",
          },
          header: {
            backgroundColor: "var(--blog-bg)",
            borderBottom: "1px solid var(--blog-border)",
          },
        }}
      >
        {/* Header */}
        <AppShell.Header>
          <Container size={1100} h="100%">
            <Flex h="100%" align="center" wrap="nowrap">
              {/* Logo */}
              <ActionButton
                anchorProps={{ underline: "never" }}
                href="/"
                unstyled
              >
                <Text
                  ff="var(--blog-font-mono)"
                  fw={700}
                  fz="1rem"
                  c="var(--blog-text)"
                  style={{ letterSpacing: "-0.02em", lineHeight: 1 }}
                >
                  alepha.blog
                </Text>
              </ActionButton>

              {/* Nav */}
              <Flex gap="lg" align="center" ml="lg" visibleFrom="xs">
                <NavLink href="/">Posts</NavLink>
                <NavLink href="/categories">Categories</NavLink>
              </Flex>

              {/* Actions — pushed right */}
              <Flex gap="xs" align="center" ml="auto">
                <DarkModeButton />
                <ClientOnly>
                  <UserButton
                    icon={null}
                    loginLabel="LOGIN"
                    variant="subtle"
                    size="xs"
                    fz="xs"
                    fw={500}
                    c="var(--blog-text-muted)"
                    className="blog-nav-link"
                    style={{
                      fontFamily: "var(--blog-font-mono)",
                      letterSpacing: "0.02em",
                    }}
                  />
                </ClientOnly>
              </Flex>
            </Flex>
          </Container>
        </AppShell.Header>

        {/* Content */}
        <AppShell.Main>
          <Container size={1100} py="xl">
            <NestedView />
          </Container>
        </AppShell.Main>
      </AppShell>

      {/* Footer */}
      <Flex
        component="footer"
        justify="center"
        py="xl"
        mt="xl"
        style={{
          borderTop: "1px solid var(--blog-border)",
          backgroundColor: "var(--blog-bg)",
        }}
      >
        <Container size={1100} w="100%">
          <Text
            fz="xs"
            c="var(--blog-text-faint)"
            ff="var(--blog-font-mono)"
            ta="center"
          >
            &copy; {new Date().getFullYear()} alepha.blog
          </Text>
        </Container>
      </Flex>
    </AlephaMantineProvider>
  );
};

export default BlogLayout;
