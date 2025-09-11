/**
 * Minimal template service with Handlebars-like syntax for email templating.
 * Supports simple variable substitution with {{variableName}} syntax.
 */
export class TemplateService {
	/**
	 * Compile a template string with the provided values.
	 *
	 * @param template Template string with {{variableName}} placeholders
	 * @param values Object containing values to substitute
	 * @returns Compiled template string with values substituted
	 *
	 * @example
	 * ```ts
	 * const service = new TemplateService();
	 * const result = service.compile("Hello {{name}}!", { name: "John" });
	 * // Result: "Hello John!"
	 * ```
	 */
	public compile(template: string, values: Record<string, unknown>): string {
		return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
			const value = values[key];
			return value !== undefined ? String(value) : match;
		});
	}

	/**
	 * Validate that all required template variables are provided.
	 *
	 * @param template Template string
	 * @param values Values object
	 * @returns Array of missing variable names
	 */
	public validateTemplate(
		template: string,
		values: Record<string, unknown>,
	): string[] {
		const variables = this.extractVariables(template);
		return variables.filter((variable) => !(variable in values));
	}

	/**
	 * Extract all variable names from a template.
	 *
	 * @param template Template string
	 * @returns Array of variable names found in the template
	 */
	public extractVariables(template: string): string[] {
		const matches = template.match(/\{\{(\w+)\}\}/g);
		if (!matches) return [];

		return matches
			.map((match) => match.slice(2, -2))
			.filter((value, index, array) => array.indexOf(value) === index);
	}
}
