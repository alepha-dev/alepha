/**
 * Minimal template service with Handlebars-like syntax for email templating.
 * Supports simple variable substitution with {{variableName}} or {{ variableName }} syntax.
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
	 *
	 * const result2 = service.compile("Hello {{ name }}!", { name: "Jane" });
	 * // Result: "Hello Jane!"
	 * ```
	 */
	public compile(template: string, values: Record<string, unknown>): string {
		return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
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
		const matches = template.match(/\{\{\s*(\w+)\s*\}\}/g);
		if (!matches) return [];

		return matches
			.map((match) => match.replace(/\{\{\s*|\s*\}\}/g, ""))
			.filter((value, index, array) => array.indexOf(value) === index);
	}
}
