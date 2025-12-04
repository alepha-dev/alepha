import { $inject, Alepha } from "alepha";
import {
  type BookingState,
  bookingAtom,
  type Seat,
} from "../../web/atoms/bookingAtom.ts";

export class BookingService {
  protected readonly alepha = $inject(Alepha);

  /**
   * Generate seats for a train.
   * First 3 rows are first class (+€35), rest are second class.
   */
  public generateSeats(trainType: string): Seat[] {
    const seats: Seat[] = [];
    const rows = trainType === "Eurostar" ? 12 : 10;

    for (let row = 1; row <= rows; row++) {
      const isFirstClass = row <= 3;

      // 4 seats per row: A (window), B (aisle), C (aisle), D (window)
      const seatLetters = ["A", "B", "C", "D"];
      const seatTypes: Array<"window" | "aisle" | "middle"> = [
        "window",
        "aisle",
        "aisle",
        "window",
      ];

      for (let i = 0; i < 4; i++) {
        const isAvailable = Math.random() > 0.3;
        seats.push({
          id: `seat-${row}-${seatLetters[i]}`,
          row,
          number: `${row}${seatLetters[i]}`,
          type: seatTypes[i],
          class: isFirstClass ? "first" : "second",
          price: isFirstClass ? 35 : 0,
          isAvailable,
        });
      }
    }

    return seats;
  }

  /**
   * Generate a 6-character booking reference.
   */
  public generateBookingReference(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let ref = "";
    for (let i = 0; i < 6; i++) {
      ref += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return ref;
  }

  /**
   * Get current booking state from store.
   */
  public getBooking(): BookingState {
    return (
      this.alepha.store.get(bookingAtom) ?? {
        step: "search",
        selectedSeats: [],
      }
    );
  }

  /**
   * Update booking state in store.
   */
  public updateBooking(updates: Partial<BookingState>) {
    const current = this.getBooking();
    this.alepha.store.set(bookingAtom, { ...current, ...updates });
  }

  /**
   * Reset booking state.
   */
  public resetBooking() {
    this.alepha.store.set(bookingAtom, {
      step: "search",
      selectedSeats: [],
    });
  }
}
