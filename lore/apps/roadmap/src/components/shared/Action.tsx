import { AlephaError } from "@alepha/core";
import { useInject } from "@alepha/react";
import { type Breakpoint, Flex } from "@alepha/react-flex";
import { Button, type ButtonProps } from "@blueprintjs/core";
import { useState } from "react";
import Toast from "../../services/Toast.ts";

const Action = (
	props: ButtonProps & { hideText?: Breakpoint; visibleText?: Breakpoint },
) => {
	const toast = useInject(Toast);
	const { hideText, visibleText, ...rest } = props;
	const [pending, setPending] = useState(false);

	const onClick = rest.onClick;
	if (onClick) {
		rest.onClick = async (e: any) => {
			if (pending) return;
			setPending(true);
			try {
				await onClick(e);
			} catch (error) {
				if (error instanceof AlephaError) {
					toast.show(error.message, "danger");
					return;
				}
				throw error;
			}
			setPending(false);
		};
	}

	rest.disabled ??= pending;

	const btn = <Button {...rest} />;

	if (visibleText) {
		const { children, text, endIcon, ...btnProps } = rest;
		return (
			<>
				<Flex visible={visibleText}>
					<Button {...rest} />
				</Flex>
				<Flex hide={visibleText}>
					<Button {...btnProps} />
				</Flex>
			</>
		);
	}

	return btn;
};

export default Action;
