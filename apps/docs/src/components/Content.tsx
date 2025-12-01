import { ClientOnly, useActive, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton } from "@alepha/ui";
import {
  Affix,
  type ButtonProps,
  Divider,
  Flex,
  SimpleGrid,
  TableOfContents,
  Text,
  Transition,
  Typography,
} from "@mantine/core";
import { useWindowScroll } from "@mantine/hooks";
import {
  IconArrowUp,
  IconCaretLeft,
  IconCaretRight,
  IconClock,
  IconEdit,
  IconHistory,
} from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { docs, repository } from "../config/docs.ts";
import { theme } from "../config/theme.ts";

interface ModuleProps {
  name: string;
  content: string;
  path?: string;
  readingTime?: number;
  lastModified?: string | null;
}

const Content = (props: ModuleProps) => {
  const [scroll, scrollTo] = useWindowScroll();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView();
      }
    }
  }, []);

  return (
    <Flex flex={1} w={"100%"}>
      <Flex flex={1} w={"100%"}>
        <Flex
          p={{ sm: "xl" }}
          style={{ margin: "0 auto", width: "100%" }}
          direction={"column"}
          maw={{
            sm: 800,
            lg: 800,
          }}
          gap={{ base: "sm", md: "xl" }}
        >
          <DocMetadata
            readingTime={props.readingTime}
            lastModified={props.lastModified}
          />
          <Typography style={{ width: "100%" }}>
            <HtmlContent html={props.content} />
          </Typography>
          <Flex>
            <ActionButton
              icon={<IconEdit />}
              variant={"subtle"}
              href={`https://github.com/${repository.name}/edit/main/${props.path}`}
            >
              Edit page on GitHub
            </ActionButton>
          </Flex>
          <Divider />
          <BottomNavButton name={props.name} />
        </Flex>
      </Flex>
      <ContentAside name={props.name} />

      <Affix position={{ bottom: 36, right: 36 }}>
        <Transition transition="slide-up" mounted={scroll.y > 300}>
          {(styles) => (
            <ActionButton
              style={styles}
              radius={"xl"}
              size={"lg"}
              px={"md"}
              icon={IconArrowUp}
              onClick={() => scrollTo({ y: 0 })}
            />
          )}
        </Transition>
      </Affix>
    </Flex>
  );
};

const DocMetadata = (props: {
  readingTime?: number;
  lastModified?: string | null;
}) => {
  const { l } = useI18n();

  if (!props.readingTime && !props.lastModified) {
    return null;
  }

  return (
    <Flex gap="md" align="center" wrap="wrap">
      {props.readingTime && (
        <Flex gap={6} align="center">
          <IconClock size={14} color="var(--mantine-color-dimmed)" />
          <Text size="sm" c="dimmed">
            {props.readingTime} min read
          </Text>
        </Flex>
      )}
      {props.lastModified && (
        <Flex gap={6} align="center">
          <IconHistory size={14} color="var(--mantine-color-dimmed)" />
          <Text size="sm" c="dimmed">
            Updated{" "}
            <ClientOnly>
              {l(props.lastModified.split("T")[0], { date: "fromNow" })}
            </ClientOnly>
          </Text>
        </Flex>
      )}
    </Flex>
  );
};

export default Content;

// ---------------------------------------------------------------------------------------------------------------------

const ContentAside = (props: { name: string }) => {
  const reinitializeRef = useRef(() => {});
  const router = useRouter();

  useLayoutEffect(() => {
    (window as any).go = (url: string) => router.go(url);
    reinitializeRef.current();
  }, [props.name]);

  return (
    <Flex w={theme.sidebarWidth} pos={"relative"} visibleFrom={"xl"}>
      <Flex pos={"fixed"} right={20}>
        <Flex
          p={"xl"}
          w={theme.sidebarWidth}
          fw={300}
          direction={"column"}
          gap={"md"}
        >
          <Text size={"sm"} fw={"bold"}>
            Table of contents
          </Text>
          <TableOfContents
            reinitializeRef={reinitializeRef}
            variant="light"
            size="sm"
            scrollSpyOptions={{
              selector: "#html-content [data-heading]",
              getDepth: (element) => Number(element.getAttribute("data-depth")),
              getValue: (element) => element.getAttribute("data-heading") || "",
            }}
            getControlProps={({ data }) => ({
              onClick: () => {
                if (data.id) {
                  const url = router.getURL();
                  url.hash = `#${data.id}`;
                  router.location.replace(url);

                  window.document.getElementById(data.id)?.scrollIntoView();
                }
              },
              children: data.value,
            })}
          />
        </Flex>
      </Flex>
    </Flex>
  );
};

const BottomNavButton = (props: { name: string }) => {
  const nav = useMemo(() => {
    const index = docs.findIndex((it) => it.name === props.name);

    return {
      next: docs[index + 1]
        ? {
            path: `/docs/${docs[index + 1].slug}`,
            name: docs[index + 1].name,
          }
        : undefined,
      previous: docs[index - 1]
        ? {
            path: `/docs/${docs[index - 1].slug}`,
            name: docs[index - 1].name,
          }
        : undefined,
    };
  }, [props.name]);

  return (
    <SimpleGrid cols={{ sm: 1, md: 2 }}>
      {nav.previous && (
        <NavButton name={nav.previous.name} href={nav.previous.path} />
      )}
      {!nav.previous && <Flex />}
      {nav.next && (
        <NavButton isRight name={nav.next.name} href={nav.next.path} />
      )}
    </SimpleGrid>
  );
};

const NavButton = (
  props: ButtonProps & {
    href: string;
    name: string;
    isRight?: boolean;
  },
) => {
  const { href, name, isRight, ...rest } = props;
  const { isPending } = useActive(href);
  return (
    <ActionButton
      flex={1}
      variant={isRight ? "outline" : "subtle"}
      size={"xl"}
      loading={isPending}
      justify={isRight ? "end" : "start"}
      href={href}
      {...rest}
    >
      <Flex gap={"md"} align={"center"}>
        {!isRight && <IconCaretLeft />}
        <Flex direction={"column"} align={isRight ? "end" : "start"}>
          <Text c={"dimmed"} size={"xs"}>
            {isRight ? "Next Page" : "Previous Page"}
          </Text>
          <Text>{name}</Text>
        </Flex>
        {isRight && <IconCaretRight />}
      </Flex>
    </ActionButton>
  );
};

export function HtmlContent(props: { html: string }) {
  const html = useMemo(() => {
    const onclick = (url: string) => {
      return `event.preventDefault();go('${url}')`;
    };
    return props.html.replace(/<a href="\/docs\/(.*)">/gim, (_, arg1) => {
      const pathname = `${import.meta.env.BASE_URL ?? "/"}docs/${arg1}`;
      return `<a href="${pathname}" onclick="${onclick(`/docs/${arg1}`)}">`;
    });
  }, [props.html]);

  return (
    <div
      id={"html-content"}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: no worry
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
