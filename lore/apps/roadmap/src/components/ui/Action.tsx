import { type Breakpoint, Flex } from "@alepha/react-flex";
import { Button, type ButtonProps } from "@blueprintjs/core";

const Action = (
	props: ButtonProps & { hideText?: Breakpoint; visibleText?: Breakpoint },
) => {
	const { hideText, visibleText, ...rest } = props;
	const btn = <Button {...rest} />;

	if (visibleText) {
		return (
			<>
				<Flex visible={visibleText}>{btn}</Flex>
				<Flex hide={visibleText}>
					<Button {...rest} text={undefined} />
				</Flex>
			</>
		);
	}

	return btn;
};

export default Action;
