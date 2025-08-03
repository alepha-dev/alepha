import { Link, useClient, useSchema } from "@alepha/react";
import { useForm } from "@alepha/react-form";
import { useI18n } from "@alepha/react-i18n";
import { useTransition } from "react";
import type Api from "./Api.ts";
import type { I18n } from "./I18n.ts";

const Hello = () => {
	const client = useClient<Api>();
	const loginSchema = useSchema(client.login);
	const { tr, setLang, lang } = useI18n<I18n, "en">();

	const form = useForm({
		id: "hello",
		schema: loginSchema.body,
		handler: async (values, { form }) => {
			console.log("Form submitted with values:", values);
			const resp = await client.login({ body: values });
			if (resp.success) {
				console.log(tr("login_success"));
			} else {
				console.log("Login failed!");
			}
			form.reset();
		},
		onCreateField: (name) => {
			return {
				placeholder: tr(name),
			};
		},
	});

	const [isPending, startTransition] = useTransition();

	return (
		<fieldset>
			<legend>Hello</legend>
			<button
				disabled={isPending}
				onClick={() => {
					startTransition(() => setLang(lang === "en" ? "fr" : "en"));
				}}
			>
				{isPending ? "..." : lang}
			</button>
			<Link to={"/page2"}>Page2</Link>

			<form onSubmit={form.onSubmit}>
				<input {...form.input.username.props} />
				<input {...form.input.password.props} />
				<button type={"submit"}>Submit</button>
			</form>
		</fieldset>
	);
};

export default Hello;
