import { AlephaError } from "@alepha/core";
import { type LinkProps, useActive, useInject } from "@alepha/react";
import { type Breakpoint, Flex } from "@alepha/react-flex";
import { AnchorButton, Button, type ButtonProps } from "@blueprintjs/core";
import { createElement, type FunctionComponent, useState } from "react";
import Toast from "../../services/Toast.ts";

export type ActionProps = ButtonProps & {
	visibleText?: Breakpoint;
	link?: LinkProps;
};

const Action = (props: ActionProps) => {
	const toast = useInject(Toast);
	let { visibleText, link, ...rest } = props;
	const [pending, setPending] = useState(false);

	const hasLink = !!link;
	const active = useActive(link?.to);

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

	let element: FunctionComponent = Button;
	if (hasLink) {
		element = AnchorButton;
		rest = {
			...rest,
			...active.anchorProps,
		};
	}

	if (visibleText) {
		const { children, text, endIcon, ...btnProps } = rest;
		return (
			<>
				<Flex visible={visibleText}>{createElement(element, rest)}</Flex>
				<Flex hide={visibleText}>{createElement(element, btnProps)}</Flex>
			</>
		);
	}

	return createElement(element, rest);
};

export default Action;
