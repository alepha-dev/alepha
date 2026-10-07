/**
 * What the calculator shows and remembers between two key presses.
 */
export interface CalculatorState {
  /**
   * The number on screen, as typed (`"0."` keeps its dot), or `"Error"`.
   */
  display: string;
  /**
   * The left operand, waiting for the operator to apply.
   */
  stored: number | null;
  operator: "+" | "-" | "×" | "÷" | null;
  /**
   * The next digit starts a new number instead of extending the display.
   */
  fresh: boolean;
}
