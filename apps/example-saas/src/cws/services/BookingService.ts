import { $inject, Alepha } from "alepha";
import {
  type BookingState,
  bookingAtom,
  type FareClassSelection,
  type Seat,
  type SeatReservation,
} from "../atoms/bookingAtom.ts";

export class BookingService {
  protected readonly alepha = $inject(Alepha);

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
        selectedAddOns: [],
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
      selectedAddOns: [],
    });
  }

  /**
   * Check if the seat reservation is still valid.
   */
  public isReservationValid(): boolean {
    const booking = this.getBooking();
    if (!booking.seatReservation?.reservedUntil) {
      return false;
    }
    return new Date(booking.seatReservation.reservedUntil) > new Date();
  }

  /**
   * Get remaining time for seat reservation in seconds.
   */
  public getReservationTimeRemaining(): number {
    const booking = this.getBooking();
    if (!booking.seatReservation?.reservedUntil) {
      return 0;
    }
    const remaining =
      new Date(booking.seatReservation.reservedUntil).getTime() - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
  }

  /**
   * Set trip instance and prepare for fare class selection.
   */
  public setTripInstance(tripInstanceId: string) {
    this.updateBooking({
      tripInstanceId,
      selectedFareClass: undefined,
      seatReservation: undefined,
      lockedPrice: undefined,
      priceValidUntil: undefined,
    });
  }

  /**
   * Set selected fare class.
   */
  public setFareClass(fareClass: FareClassSelection) {
    this.updateBooking({
      selectedFareClass: fareClass,
      lockedPrice: fareClass.price,
      dynamicMultiplier: fareClass.dynamicMultiplier,
    });
  }

  /**
   * Set seat reservation.
   */
  public setSeatReservation(reservation: SeatReservation, seats: Seat[]) {
    this.updateBooking({
      seatReservation: reservation,
      selectedSeats: seats,
    });
  }

  /**
   * Clear seat reservation.
   */
  public clearSeatReservation() {
    this.updateBooking({
      seatReservation: undefined,
      selectedSeats: [],
    });
  }
}
