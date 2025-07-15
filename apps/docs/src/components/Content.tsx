import { useActive, useRouter } from "@alepha/react";
import {
	Button,
	type ButtonProps,
	Divider,
	Flex,
	SimpleGrid,
	TableOfContents,
	Text,
	TypographyStylesProvider,
} from "@mantine/core";
import { IconCaretLeft, IconCaretRight, IconEdit } from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { docs, repository } from "../config/docs.ts";
import { theme } from "../config/theme.ts";

interface ModuleProps {
	name: string;
	content: string;
	path?: string;
}

const Content = (props: ModuleProps) => {
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
					<TypographyStylesProvider style={{ width: "100%" }}>
						<HtmlContent html={props.content} />
					</TypographyStylesProvider>
					<Flex>
						<Button
							leftSection={<IconEdit />}
							variant={"subtle"}
							component={"a"}
							href={`https://github.com/${repository.name}/edit/main/${props.path}`}
						>
							Edit page on GitHub
						</Button>
					</Flex>
					<Divider />
					<BottomNavButton name={props.name} />
				</Flex>
			</Flex>
			<ContentAside name={props.name} />
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
				<Flex p={"xl"} w={theme.sidebarWidth} fw={300}>
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
				<NavButton name={nav.previous.name} to={nav.previous.path} />
			)}
			{!nav.previous && <Flex />}
			{nav.next && (
				<NavButton isRight name={nav.next.name} to={nav.next.path} />
			)}
		</SimpleGrid>
	);
};

const NavButton = (
	props: ButtonProps & {
		to: string;
		name: string;
		isRight?: boolean;
	},
) => {
	const { to, name, isRight, ...rest } = props;
	const { isPending, anchorProps } = useActive(to);
	return (
		<Button
			flex={1}
			variant={isRight ? "outline" : "subtle"}
			size={"xl"}
			loading={isPending}
			justify={isRight ? "end" : "start"}
			{...rest}
			{...anchorProps}
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
		</Button>
	);
};

export function HtmlContent(props: { html: string }) {
	const html = useMemo(() => {
		const onclick = (url: string) => {
			return `event.preventDefault();go('${url}')`;
		};
		return props.html.replace(/<a href="\/docs\/(.*)">/gim, (_, arg1) => {
			const pathname = `${import.meta.env.BASE_URL ?? "/"}docs/${arg1}`;
			return `<a href="${pathname}" onclick="${onclick(`${pathname}`)}">`;
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
