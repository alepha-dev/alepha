export interface StationSeed {
  name: string;
  code: string;
  city: string;
  country: string;
}

export interface TripSeed {
  from: string;
  to: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  trainNumber: string;
  trainType: string;
  basePrice: number;
  availableSeats: number;
}

export interface SeedData {
  name: string;
  stations: StationSeed[];
  trips: TripSeed[];
}
