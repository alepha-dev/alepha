import { useActive, useRouterEvents } from "@alepha/react";
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
import { IconCaretLeft, IconCaretRight } from "@tabler/icons-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { docs } from "../config/docs.ts";
import { theme } from "../config/theme.ts";

interface ModuleProps {
	name: string;
	content: string;
}

const Content = (props: ModuleProps) => {
	const reinitializeRef = useRef(() => {});

	useLayoutEffect(() => {
		reinitializeRef.current();
	}, [props.name]);

	return (
		<Flex flex={1} w={"100%"}>
			<Flex flex={1} w={"100%"}>
				<Flex
					p={{ sm: "xl" }}
					style={{ margin: "0 auto", width: "100%" }}
					direction={"column"}
					maw={{
						sm: 800,
						lg: 1000,
					}}
					gap={"md"}
				>
					<TypographyStylesProvider style={{ width: "100%" }}>
						<HtmlContent html={props.content} />
					</TypographyStylesProvider>
					<Divider />
					<BottomNavButton name={props.name} />
				</Flex>
			</Flex>
			<Flex w={theme.sidebarWidth} pos={"relative"} visibleFrom={"xl"}>
				<Flex pos={"fixed"} right={20}>
					<Flex p={"xl"} w={theme.sidebarWidth} fw={300}>
						<TableOfContents
							reinitializeRef={reinitializeRef}
							variant="light"
							size="sm"
							scrollSpyOptions={{
								selector: "#mdx :is(h1, h2, h3, h4, h5, h6)",
							}}
							getControlProps={({ data }) => ({
								onClick: () => data.getNode().scrollIntoView(),
								children: data.value,
							})}
						/>
					</Flex>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default Content;

// ---------------------------------------------------------------------------------------------------------------------

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

	const [isPending, setIsPending] = useState(false);

	useRouterEvents({
		onBegin: () => setIsPending(true),
		onEnd: () => setIsPending(false),
	});

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
	const { to, name, ...rest } = props;
	const { isPending, anchorProps } = useActive(to);
	return (
		<Button
			flex={1}
			variant={props.isRight ? "outline" : "subtle"}
			size={"xl"}
			loading={isPending}
			{...rest}
			{...anchorProps}
		>
			<Flex gap={"md"} align={"center"}>
				{!props.isRight && <IconCaretLeft />}
				<Flex direction={"column"} align={props.isRight ? "end" : "start"}>
					<Text c={"dimmed"} size={"xs"}>
						{props.isRight ? "Next Page" : "Previous Page"}
					</Text>
					<Text>{name}</Text>
				</Flex>
				{props.isRight && <IconCaretRight />}
			</Flex>
		</Button>
	);
};

export function HtmlContent({ html }: { html: string }) {
	return (
		<div
			id={"mdx"}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: no worry
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
