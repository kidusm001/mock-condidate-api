import type { Candidate } from "./types.ts";

const TIMEOUT_MS = 5000;

type FrappePayload = {
	candidate_name: string;
	phone: string;
	external_request_id: string;
	dropoff_landmark_raw: string;
	dropoff_place_place_id: string;
	dropoff_place_display_name: string;
	dropoff_place_formatted_address: string;
	dropoff_place_lat: string;
	dropoff_place_lng: string;
};

function toFrappePayload(c: Candidate): FrappePayload {
	const place = c.dropoff_place;
	return {
		candidate_name: c.candidate_name,
		phone: c.phone ?? "",
		external_request_id: c.id ?? "",
		dropoff_landmark_raw: c.dropoff_location,
		dropoff_place_place_id: place?.place_id ?? "",
		dropoff_place_display_name: place?.display_name ?? "",
		dropoff_place_formatted_address: place?.formatted_address ?? "",
		dropoff_place_lat: place?.lat != null ? String(place.lat) : "",
		dropoff_place_lng: place?.lng != null ? String(place.lng) : "",
	};
}

export function notifyCandidateCreated(candidate: Candidate): void {
	const url = process.env.WEBHOOK_URL;
	if (!url) return;

	const body = new URLSearchParams(toFrappePayload(candidate)).toString();

	const headers: Record<string, string> = {
		"Content-Type": "application/x-www-form-urlencoded",
		"X-Mock-Event": "candidate.created",
	};
	const apiKey = process.env.API_KEY;
	if (apiKey) {
		headers["Authorization"] = `token ${apiKey}`;
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

	fetch(url, {
		method: "POST",
		headers,
		body,
		signal: controller.signal,
	})
		.then((res) => {
			if (!res.ok) {
				console.error(`[webhook] non-2xx response: ${res.status} ${res.statusText}`);
			} else {
				console.log(`[webhook] delivered candidate.created for ${candidate.name}`);
			}
		})
		.catch((err) => {
			console.error(`[webhook] delivery failed: ${(err as Error).message}`);
		})
		.finally(() => clearTimeout(timeout));
}
