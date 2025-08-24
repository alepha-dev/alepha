import { Card, type CardProps } from "@mantine/core";

export interface PanelProps extends CardProps {}

const Panel = (props: PanelProps) => {
	return (
		<Card
			p={0}
			bg={"var(--app-bg-color"}
			{...props}
			className={"shadow"}
		></Card>
	);
};

export default Panel;
