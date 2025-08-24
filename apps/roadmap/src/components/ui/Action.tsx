import { type UseActiveOptions, useActive } from "@alepha/react";
import { type FormModel, useFormState } from "@alepha/react-form";
import { Button, type ButtonProps, Flex } from "@mantine/core";
import { type ReactNode, useState } from "react";

export type ActionProps = ButtonProps & {
	children?: ReactNode;
	textVisibleFrom?: "xs" | "sm" | "md" | "lg" | "xl";
} & (ActiveHrefProps | ActionClickProps | ActionSubmitProps | {});

const Action = (props: ActionProps) => {
	if (props.textVisibleFrom) {
		const { children, textVisibleFrom, leftSection, ...rest } = props;
		return (
			<>
				<Flex visibleFrom={textVisibleFrom}>
					<Action {...rest} leftSection={leftSection}>
						{children}
					</Action>
				</Flex>
				<Flex hiddenFrom={textVisibleFrom}>
					<Action {...rest} px={"xs"}>
						{leftSection}
					</Action>
				</Flex>
			</>
		);
	}

	if ("href" in props && props.href) {
		return (
			<ActionHref {...props} href={props.href}>
				{props.children}
			</ActionHref>
		);
	}

	if ("onClick" in props && props.onClick) {
		return (
			<ActionClick {...props} onClick={props.onClick}>
				{props.children}
			</ActionClick>
		);
	}

	if ("form" in props && props.form) {
		return (
			<ActionSubmit {...props} form={props.form}>
				{props.children}
			</ActionSubmit>
		);
	}

	return <Button {...(props as any)}>{props.children}</Button>;
};

export default Action;

export interface ActionSubmitProps extends ButtonProps {
	form: FormModel<any>;
}

const ActionSubmit = (props: ActionSubmitProps) => {
	const { form, ...buttonProps } = props;
	const state = useFormState(form);
	return (
		<Button
			{...buttonProps}
			loading={state.loading}
			disabled={state.loading || !state.dirty}
			type={"submit"}
		>
			{props.children}
		</Button>
	);
};

export interface ActionClickProps extends ButtonProps {
	onClick: (e: any) => any;
}

const ActionClick = (props: ActionClickProps) => {
	const [pending, setPending] = useState(false);

	const onClick = async (e: any) => {
		setPending(true);
		try {
			await props.onClick(e);
		} catch (e) {
			console.error(e);
		} finally {
			setPending(false);
		}
	};

	return (
		<Button {...props} disabled={pending} loading={pending} onClick={onClick}>
			{props.children}
		</Button>
	);
};

export interface ActiveHrefProps extends ButtonProps {
	href: string;
	active?: Partial<UseActiveOptions> | false;
}

const ActionHref = (props: ActiveHrefProps) => {
	const { active: options, ...buttonProps } = props;
	const { anchorProps, isPending, isActive } = useActive(
		options ? { href: props.href, ...options } : { href: props.href },
	);

	return (
		<Button
			component={"a"}
			loading={isPending}
			{...anchorProps}
			{...buttonProps}
			variant={isActive && options !== false ? "filled" : "subtle"}
		>
			{props.children}
		</Button>
	);
};
