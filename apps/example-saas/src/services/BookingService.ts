import { $inject, Alepha } from "alepha";
import {
  type BookingState,
  bookingAtom,
  type Seat,
  type Trip,
} from "../atoms/bookingAtom.ts";

export class BookingService {
  protected readonly alepha = $inject(Alepha);

  public readonly stations = [
    "Paris Gare du Nord",
    "London St Pancras",
    "Amsterdam Centraal",
    "Brussels Midi",
    "Frankfurt Hbf",
    "Cologne Hbf",
    "Lyon Part-Dieu",
    "Marseille Saint-Charles",
    "Barcelona Sants",
    "Milan Centrale",
  ];

  public searchTrips(from: string, to: string, date: string): Trip[] {
    const baseTrips: Trip[] = [
      {
        id: "tr-001",
        departureStation: from,
        arrivalStation: to,
        departureTime: "06:15",
        arrivalTime: "08:47",
        duration: "2h 32min",
        trainNumber: "TGV 6201",
        trainType: "TGV INOUI",
        price: 79,
        availableSeats: 142,
      },
      {
        id: "tr-002",
        departureStation: from,
        arrivalStation: to,
        departureTime: "08:30",
        arrivalTime: "10:58",
        duration: "2h 28min",
        trainNumber: "TGV 6205",
        trainType: "TGV INOUI",
        price: 99,
        availableSeats: 89,
      },
      {
        id: "tr-003",
        departureStation: from,
        arrivalStation: to,
        departureTime: "10:45",
        arrivalTime: "13:22",
        duration: "2h 37min",
        trainNumber: "ICE 9556",
        trainType: "ICE",
        price: 119,
        availableSeats: 67,
      },
      {
        id: "tr-004",
        departureStation: from,
        arrivalStation: to,
        departureTime: "12:00",
        arrivalTime: "14:25",
        duration: "2h 25min",
        trainNumber: "EUR 9120",
        trainType: "Eurostar",
        price: 149,
        availableSeats: 234,
      },
      {
        id: "tr-005",
        departureStation: from,
        arrivalStation: to,
        departureTime: "14:30",
        arrivalTime: "17:05",
        duration: "2h 35min",
        trainNumber: "TGV 6221",
        trainType: "TGV INOUI",
        price: 89,
        availableSeats: 156,
      },
      {
        id: "tr-006",
        departureStation: from,
        arrivalStation: to,
        departureTime: "17:15",
        arrivalTime: "19:48",
        duration: "2h 33min",
        trainNumber: "TGV 6231",
        trainType: "TGV INOUI",
        price: 109,
        availableSeats: 45,
      },
      {
        id: "tr-007",
        departureStation: from,
        arrivalStation: to,
        departureTime: "19:00",
        arrivalTime: "21:32",
        duration: "2h 32min",
        trainNumber: "ICE 9572",
        trainType: "ICE",
        price: 129,
        availableSeats: 78,
      },
    ];

    return baseTrips;
  }

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

  public generateBookingReference(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let ref = "";
    for (let i = 0; i < 6; i++) {
      ref += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return ref;
  }

  public getBooking(): BookingState {
    return (
      this.alepha.store.get(bookingAtom) ?? {
        step: "search",
        selectedSeats: [],
      }
    );
  }

  public updateBooking(updates: Partial<BookingState>) {
    const current = this.getBooking();
    this.alepha.store.set(bookingAtom, { ...current, ...updates });
  }

  public resetBooking() {
    this.alepha.store.set(bookingAtom, {
      step: "search",
      selectedSeats: [],
    });
  }
}
