import {
	Card,
	Container,
	Flex,
	TableOfContents,
	TypographyStylesProvider,
} from "@mantine/core";

interface ModuleProps {
	data: any;
}

const Module = (props: ModuleProps) => {
	return (
		<Flex flex={1}>
			<Flex flex={1}>
				<Card
					p={"xl"}
					withBorder
					style={{ maxWidth: "800px", margin: "0 auto" }}
				>
					<TypographyStylesProvider>
						<div
							id={"mdx"}
							// biome-ignore lint/security/noDangerouslySetInnerHtml: no worry
							dangerouslySetInnerHTML={{ __html: props.data.readme }}
						/>
					</TypographyStylesProvider>
				</Card>
			</Flex>
			<Flex w={"300px"} pos={"relative"} visibleFrom={"sm"}>
				<Flex pos={"fixed"} right={20}>
					<Card w={"300px"} withBorder>
						<TableOfContents
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
					</Card>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default Module;
