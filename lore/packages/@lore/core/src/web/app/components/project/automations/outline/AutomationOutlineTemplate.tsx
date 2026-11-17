export interface AutomationOutlineTemplateProps {
  text: string;
  /**
   * The first line only, for a summary; the whole text otherwise.
   */
  line?: boolean;
}

/**
 * A template with its `{{placeholders}}` drawn as chips (#Q3847).
 */
const AutomationOutlineTemplate = (props: AutomationOutlineTemplateProps) => {
  const text = props.line ? props.text.split("\n")[0] : props.text;
  const parts = text.split(/(\{\{[^}]+\}\})/);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("{{") && part.endsWith("}}") ? (
          <code
            key={index}
            className="bg-foreground/8 text-foreground rounded px-1 font-mono text-[0.85em]"
          >
            {part.slice(2, -2).trim()}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
};

export default AutomationOutlineTemplate;
