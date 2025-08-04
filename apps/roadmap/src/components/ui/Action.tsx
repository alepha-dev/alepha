import { AlephaError } from "@alepha/core";
import { useInject } from "@alepha/react";
import { type Breakpoint, Flex } from "@alepha/react-flex";
import { Button, type ButtonProps } from "@blueprintjs/core";
import Toast from "../../services/Toast.ts";

const Action = (
	props: ButtonProps & { hideText?: Breakpoint; visibleText?: Breakpoint },
) => {
	const toast = useInject(Toast);
	const { hideText, visibleText, ...rest } = props;

	const onClick = rest.onClick;
	if (onClick) {
		rest.onClick = async (e: any) => {
			try {
				await onClick(e);
			} catch (error) {
				if (error instanceof AlephaError) {
					toast.show(error.message, "danger");
					return;
				}
				throw error;
			}
		};
	}

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
