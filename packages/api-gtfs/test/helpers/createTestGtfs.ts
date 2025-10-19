import JSZip from "jszip";

/**
 * Creates a realistic GTFS test file with a simple transit system
 *
 * System design:
 * - 5 stops in a line: A -> B -> C -> D -> E
 * - 2 routes:
 *   - Route 1 (Bus): A -> B -> C -> D -> E
 *   - Route 2 (Express): A -> C -> E
 * - Multiple trips throughout the day
 * - Service runs Monday-Friday
 */
export async function createTestGtfs(): Promise<Buffer> {
	const zip = new JSZip();

	// Stops: 5 stops in a line representing a realistic transit route
	const stops = [
		{
			id: "stop_downtown",
			name: "Downtown Transit Center",
			lat: 37.7749,
			lon: -122.4194,
		},
		{ id: "stop_library", name: "City Library", lat: 37.7849, lon: -122.4094 },
		{
			id: "stop_university",
			name: "University Campus",
			lat: 37.7949,
			lon: -122.3994,
		},
		{ id: "stop_mall", name: "Riverside Mall", lat: 37.8049, lon: -122.3894 },
		{
			id: "stop_airport",
			name: "Airport Terminal",
			lat: 37.8149,
			lon: -122.3794,
		},
	];

	const stopsContent = [
		"stop_id,stop_name,stop_lat,stop_lon",
		...stops.map((s) => `${s.id},${s.name},${s.lat},${s.lon}`),
	].join("\n");

	zip.file("stops.txt", stopsContent);

	// Routes: Regular bus and express bus
	const routesContent = [
		"route_id,route_short_name,route_long_name,route_type",
		"route_1,101,Downtown-Airport Local,3", // Bus
		"route_2,201,Downtown-Airport Express,3", // Bus
	].join("\n");

	zip.file("routes.txt", routesContent);

	// Calendar: Service runs Monday-Friday
	const calendarContent = [
		"service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
		"weekday,1,1,1,1,1,0,0,20240101,20241231",
	].join("\n");

	zip.file("calendar.txt", calendarContent);

	// Trips: Multiple trips for each route
	const trips: Array<{ tripId: string; routeId: string; headsign: string }> =
		[];

	// Route 1 trips (every 30 minutes from 6:00 to 22:00)
	for (let hour = 6; hour <= 22; hour++) {
		for (const minute of [0, 30]) {
			const tripId = `trip_1_${hour}_${minute}`;
			trips.push({
				tripId,
				routeId: "route_1",
				headsign: "To Airport Terminal",
			});
		}
	}

	// Route 2 trips (express, every hour from 7:00 to 21:00)
	for (let hour = 7; hour <= 21; hour++) {
		const tripId = `trip_2_${hour}_00`;
		trips.push({
			tripId,
			routeId: "route_2",
			headsign: "Airport Express",
		});
	}

	const tripsContent = [
		"trip_id,route_id,service_id,trip_headsign",
		...trips.map((t) => `${t.tripId},${t.routeId},weekday,${t.headsign}`),
	].join("\n");

	zip.file("trips.txt", tripsContent);

	// Stop times: Create schedules for each trip
	const stopTimes: string[] = [
		"trip_id,arrival_time,departure_time,stop_id,stop_sequence",
	];

	for (const trip of trips) {
		if (trip.routeId === "route_1") {
			// Regular route: Downtown -> Library -> University -> Mall -> Airport (5 minutes between stops)
			const [, , hourStr, minuteStr] = trip.tripId.split("_");
			const startMinutes =
				Number.parseInt(hourStr, 10) * 60 + Number.parseInt(minuteStr, 10);

			const schedule = [
				{ stopId: "stop_downtown", offset: 0 },
				{ stopId: "stop_library", offset: 5 },
				{ stopId: "stop_university", offset: 10 },
				{ stopId: "stop_mall", offset: 15 },
				{ stopId: "stop_airport", offset: 20 },
			];

			for (let i = 0; i < schedule.length; i++) {
				const { stopId, offset } = schedule[i];
				const minutes = startMinutes + offset;
				const time = formatTime(minutes);
				stopTimes.push(`${trip.tripId},${time},${time},${stopId},${i + 1}`);
			}
		} else {
			// Express route: Downtown -> University -> Airport (10 minutes between stops)
			const [, , hourStr] = trip.tripId.split("_");
			const startMinutes = Number.parseInt(hourStr, 10) * 60;

			const schedule = [
				{ stopId: "stop_downtown", offset: 0 },
				{ stopId: "stop_university", offset: 10 },
				{ stopId: "stop_airport", offset: 20 },
			];

			for (let i = 0; i < schedule.length; i++) {
				const { stopId, offset } = schedule[i];
				const minutes = startMinutes + offset;
				const time = formatTime(minutes);
				stopTimes.push(`${trip.tripId},${time},${time},${stopId},${i + 1}`);
			}
		}
	}

	zip.file("stop_times.txt", stopTimes.join("\n"));

	return await zip.generateAsync({ type: "nodebuffer" });
}

function formatTime(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:00`;
}
