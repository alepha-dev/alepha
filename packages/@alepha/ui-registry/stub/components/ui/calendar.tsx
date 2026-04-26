export interface CalendarProps {
  mode?: "single" | "multiple" | "range";
  selected?: Date;
  onSelect?: (date: Date | undefined) => void;
  disabled?: boolean | ((date: Date) => boolean);
  initialFocus?: boolean;
  className?: string;
}

export const Calendar: (props: CalendarProps) => any = () => null;
