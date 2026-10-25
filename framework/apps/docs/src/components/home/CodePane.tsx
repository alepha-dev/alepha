export interface CodePaneProps {
  html: string;
  label?: string;
}

const CodePane = (props: CodePaneProps) => {
  return (
    <div className="code-pane">
      {props.label ? (
        <div className="code-pane-label">{props.label}</div>
      ) : null}
      <div
        className="code-demo-content"
        // HTML is sanitized at build time
        dangerouslySetInnerHTML={{ __html: props.html }}
      />
    </div>
  );
};

export default CodePane;
