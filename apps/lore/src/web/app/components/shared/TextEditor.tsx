import { Textarea } from "@alepha/ui/components/ui/textarea";

export interface TextEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

const TextEditor = (props: TextEditorProps) => {
  return (
    <Textarea
      value={props.value ?? ""}
      onChange={(e) => props.onChange?.(e.target.value)}
      placeholder={props.placeholder}
      rows={props.rows ?? 14}
      className="min-h-64 font-mono text-sm"
    />
  );
};

export default TextEditor;
