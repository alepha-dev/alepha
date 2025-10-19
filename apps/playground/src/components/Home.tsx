import type {
	GtfsDatasetController,
	GtfsPlannerController,
	GtfsTopologyController,
} from "@alepha/api-gtfs";
import { useClient } from "@alepha/react";
import { useEffect, useState } from "react";

interface ImportResult {
	success: boolean;
	dataset: string;
	counts?: {
		stops: number;
		routes: number;
		trips: number;
		stopTimes: number;
		calendar: number;
		calendarDates: number;
	};
	message?: string;
}

interface Journey {
	legs: Array<{
		tripId: string;
		routeId: string;
		routeName: string;
		departureStop: string;
		departureStopName: string;
		departureTime: string;
		arrivalStop: string;
		arrivalStopName: string;
		arrivalTime: string;
		headsign?: string;
	}>;
	totalDuration: number;
	departureTime: string;
	arrivalTime: string;
}

const Home = () => {
	const gtfsDatasetApi = useClient<GtfsDatasetController>();
	const gtfsTopologyApi = useClient<GtfsTopologyController>();
	const gtfsPlannerApi = useClient<GtfsPlannerController>();

	const [importing, setImporting] = useState(false);
	const [importResult, setImportResult] = useState<ImportResult | null>(null);
	const [datasets, setDatasets] = useState<
		Array<{ name: string; url: string }>
	>([]);

	// Journey planner state
	const [selectedDataset, setSelectedDataset] = useState("");
	const [origin, setOrigin] = useState("");
	const [destination, setDestination] = useState("");
	const [departureDate, setDepartureDate] = useState(
		new Date().toISOString().split("T")[0].replace(/-/g, ""),
	);
	const [departureTime, setDepartureTime] = useState("08:00");
	const [searching, setSearching] = useState(false);
	const [journeys, setJourneys] = useState<Journey[]>([]);
	const [error, setError] = useState<string | null>(null);

	// Stops for autocomplete
	const [stops, setStops] = useState<
		Array<{ stopId: string; stopName: string }>
	>([]);
	const [loadingStops, setLoadingStops] = useState(false);

	const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		setImporting(true);
		setImportResult(null);
		setError(null);

		try {
			const result = await gtfsDatasetApi.importGtfsFile({
				body: {
					file,
				},
			});

			setImportResult(result);

			if (result.success) {
				// Refresh datasets list
				await loadDatasets();
				setSelectedDataset(result.dataset);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to import dataset");
		} finally {
			setImporting(false);
		}
	};

	const loadDatasets = async () => {
		try {
			const result = await gtfsDatasetApi.listDatasets();
			setDatasets(result.datasets);
			if (result.datasets.length > 0 && !selectedDataset) {
				setSelectedDataset(result.datasets[0].name);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load datasets");
		}
	};

	const loadStops = async () => {
		if (!selectedDataset) return;

		setLoadingStops(true);
		try {
			const result = await gtfsTopologyApi.queryStops({
				query: {
					dataset: selectedDataset,
					limit: 100,
				},
			});
			setStops(result.data);
		} catch (err) {
			console.error("Failed to load stops:", err);
		} finally {
			setLoadingStops(false);
		}
	};

	const searchJourneys = async () => {
		if (!origin || !destination) {
			setError("Please select both origin and destination");
			return;
		}

		setSearching(true);
		setError(null);
		setJourneys([]);

		try {
			const result = await gtfsPlannerApi.planJourney({
				body: {
					dataset: selectedDataset || undefined,
					origin,
					destination,
					departureDate,
					departureTime,
					maxResults: 5,
				},
			});

			setJourneys(result.journeys);
			if (result.journeys.length === 0) {
				setError("No journeys found for the selected criteria");
			}
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to search for journeys",
			);
		} finally {
			setSearching(false);
		}
	};

	const formatDuration = (minutes: number): string => {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (hours === 0) return `${mins}m`;
		if (mins === 0) return `${hours}h`;
		return `${hours}h ${mins}m`;
	};

	const formatTime = (time: string): string => {
		return time.substring(0, 5); // HH:MM from HH:MM:SS
	};

	const formatDate = (dateStr: string): string => {
		// YYYYMMDD -> YYYY-MM-DD
		return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
	};

	// Load datasets on mount
	useEffect(() => {
		loadDatasets();
	}, []);

	// Load stops when dataset changes
	useEffect(() => {
		if (selectedDataset) {
			loadStops();
		}
	}, [selectedDataset]);

	return (
		<div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
			<div className="max-w-6xl mx-auto">
				{/* Import Dataset Section */}
				<div className="bg-white rounded-lg shadow-lg p-6 mb-8">
					<h2 className="text-2xl font-semibold text-gray-700 mb-4">
						Import Dataset
					</h2>

					<div className="flex items-center gap-4">
						<label className="flex-1">
							<input
								type="file"
								accept=".zip"
								onChange={handleFileImport}
								disabled={importing}
								className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 disabled:opacity-50"
							/>
						</label>

						<button
							onClick={loadDatasets}
							className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition"
						>
							Refresh Datasets
						</button>
					</div>

					{importing && (
						<div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
							<p className="text-blue-700 flex items-center gap-2">
								<svg
									className="animate-spin h-5 w-5"
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
								>
									<circle
										className="opacity-25"
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										strokeWidth="4"
									/>
									<path
										className="opacity-75"
										fill="currentColor"
										d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
									/>
								</svg>
								Importing dataset...
							</p>
						</div>
					)}

					{importResult && (
						<div
							className={`mt-4 p-4 rounded-md ${importResult.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}
						>
							<h3
								className={`font-semibold mb-2 ${importResult.success ? "text-green-800" : "text-red-800"}`}
							>
								{importResult.success
									? "✓ Import Successful"
									: "✗ Import Failed"}
							</h3>
							{importResult.success && importResult.counts && (
								<div className="grid grid-cols-3 gap-4 text-sm text-gray-700">
									<div>
										<span className="font-medium">Stops:</span>{" "}
										{importResult.counts.stops}
									</div>
									<div>
										<span className="font-medium">Routes:</span>{" "}
										{importResult.counts.routes}
									</div>
									<div>
										<span className="font-medium">Trips:</span>{" "}
										{importResult.counts.trips}
									</div>
									<div>
										<span className="font-medium">Stop Times:</span>{" "}
										{importResult.counts.stopTimes}
									</div>
									<div>
										<span className="font-medium">Calendar:</span>{" "}
										{importResult.counts.calendar}
									</div>
									<div>
										<span className="font-medium">Calendar Dates:</span>{" "}
										{importResult.counts.calendarDates}
									</div>
								</div>
							)}
							{importResult.message && (
								<p className="text-red-700 text-sm mt-2">
									{importResult.message}
								</p>
							)}
						</div>
					)}

					{datasets.length > 0 && (
						<div className="mt-4">
							<h3 className="text-sm font-medium text-gray-700 mb-2">
								Available Datasets ({datasets.length})
							</h3>
							<div className="flex flex-wrap gap-2">
								{datasets.map((dataset) => (
									<span
										key={dataset.name}
										className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm"
									>
										{dataset.name}
									</span>
								))}
							</div>
						</div>
					)}
				</div>

				{/* Journey Planner Section */}
				<div className="bg-white rounded-lg shadow-lg p-6">
					<h2 className="text-2xl font-semibold text-gray-700 mb-6">
						Plan Your Journey
					</h2>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
						{/* Dataset Selection */}
						<div className="md:col-span-2">
							<label className="block text-sm font-medium text-gray-700 mb-2">
								Dataset
							</label>
							<select
								value={selectedDataset}
								onChange={(e) => setSelectedDataset(e.target.value)}
								className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
							>
								<option value="">Select a dataset</option>
								{datasets.map((dataset) => (
									<option key={dataset.name} value={dataset.name}>
										{dataset.name}
									</option>
								))}
							</select>
						</div>

						{/* Origin */}
						<div>
							<label className="block text-sm font-medium text-gray-700 mb-2">
								From
							</label>
							<select
								value={origin}
								onChange={(e) => setOrigin(e.target.value)}
								disabled={loadingStops || stops.length === 0}
								className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
							>
								<option value="">Select origin stop</option>
								{stops.map((stop) => (
									<option key={stop.stopId} value={stop.stopId}>
										{stop.stopName}
									</option>
								))}
							</select>
						</div>

						{/* Destination */}
						<div>
							<label className="block text-sm font-medium text-gray-700 mb-2">
								To
							</label>
							<select
								value={destination}
								onChange={(e) => setDestination(e.target.value)}
								disabled={loadingStops || stops.length === 0}
								className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
							>
								<option value="">Select destination stop</option>
								{stops.map((stop) => (
									<option key={stop.stopId} value={stop.stopId}>
										{stop.stopName}
									</option>
								))}
							</select>
						</div>

						{/* Departure Date */}
						<div>
							<label className="block text-sm font-medium text-gray-700 mb-2">
								Departure Date
							</label>
							<input
								type="date"
								value={formatDate(departureDate)}
								onChange={(e) =>
									setDepartureDate(e.target.value.replace(/-/g, ""))
								}
								className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
							/>
						</div>

						{/* Departure Time */}
						<div>
							<label className="block text-sm font-medium text-gray-700 mb-2">
								Departure Time
							</label>
							<input
								type="time"
								value={departureTime}
								onChange={(e) => setDepartureTime(e.target.value)}
								className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
							/>
						</div>
					</div>

					{/* Search Button */}
					<button
						onClick={searchJourneys}
						disabled={searching || !origin || !destination}
						className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
					>
						{searching ? (
							<>
								<svg
									className="animate-spin h-5 w-5"
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
								>
									<circle
										className="opacity-25"
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										strokeWidth="4"
									/>
									<path
										className="opacity-75"
										fill="currentColor"
										d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
									/>
								</svg>
								Searching...
							</>
						) : (
							<>
								<svg
									className="w-5 h-5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
									/>
								</svg>
								Search Journeys
							</>
						)}
					</button>

					{/* Error Message */}
					{error && (
						<div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
							<p className="text-red-700 text-sm">{error}</p>
						</div>
					)}

					{/* Journey Results */}
					{journeys.length > 0 && (
						<div className="mt-8">
							<h3 className="text-xl font-semibold text-gray-700 mb-4">
								Available Journeys ({journeys.length})
							</h3>

							<div className="space-y-4">
								{journeys.map((journey, idx) => (
									<div
										key={idx}
										className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition"
									>
										{/* Journey Summary */}
										<div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200">
											<div className="flex items-center gap-8">
												<div>
													<div className="text-2xl font-bold text-gray-800">
														{formatTime(journey.departureTime)}
													</div>
													<div className="text-sm text-gray-500">Departure</div>
												</div>

												<div className="flex items-center gap-2">
													<div className="h-px w-12 bg-gray-300" />
													<div className="text-sm font-medium text-indigo-600">
														{formatDuration(journey.totalDuration)}
													</div>
													<div className="h-px w-12 bg-gray-300" />
												</div>

												<div>
													<div className="text-2xl font-bold text-gray-800">
														{formatTime(journey.arrivalTime)}
													</div>
													<div className="text-sm text-gray-500">Arrival</div>
												</div>
											</div>

											<div className="text-right">
												<div className="text-sm text-gray-500">
													{journey.legs.length === 1
														? "Direct"
														: `${journey.legs.length} transfers`}
												</div>
											</div>
										</div>

										{/* Journey Legs */}
										<div className="space-y-3">
											{journey.legs.map((leg, legIdx) => (
												<div
													key={legIdx}
													className="flex items-start gap-4 bg-gray-50 rounded-md p-3"
												>
													{/* Route Badge */}
													<div className="flex-shrink-0">
														<div className="w-16 h-16 bg-indigo-600 text-white rounded-md flex items-center justify-center font-bold text-sm">
															{leg.routeName}
														</div>
													</div>

													{/* Leg Details */}
													<div className="flex-1">
														<div className="font-medium text-gray-800 mb-1">
															{leg.headsign || "No headsign"}
														</div>

														<div className="grid grid-cols-2 gap-4 text-sm">
															<div>
																<div className="text-gray-500">From</div>
																<div className="font-medium text-gray-800">
																	{leg.departureStopName}
																</div>
																<div className="text-indigo-600">
																	{formatTime(leg.departureTime)}
																</div>
															</div>

															<div>
																<div className="text-gray-500">To</div>
																<div className="font-medium text-gray-800">
																	{leg.arrivalStopName}
																</div>
																<div className="text-indigo-600">
																	{formatTime(leg.arrivalTime)}
																</div>
															</div>
														</div>
													</div>
												</div>
											))}
										</div>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default Home;
