import * as store from "./store.ts";
import * as settings from "./settings.ts";
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
	priority: string;
	recruiter_email: string;
	recruiter_name: string;
};

function toFrappePayload(c: Candidate, recruiter: settings.RecruiterSettings | null): FrappePayload {
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
		priority: c.priority ? "true" : "false",
		recruiter_email: recruiter?.email ?? "",
		recruiter_name: recruiter?.name ?? "",
	};
}

export function notifyCandidateCreated(candidate: Candidate): void {
	const url = process.env.WEBHOOK_URL;
	if (!url) return;

	settings
		.get()
		.then((recruiter) => {
			const body = new URLSearchParams(toFrappePayload(candidate, recruiter)).toString();
			sendWebhook(url, candidate, body);
		})
		.catch((err) => {
			console.error(`[webhook] could not load recruiter settings: ${(err as Error).message}`);
			const body = new URLSearchParams(toFrappePayload(candidate, null)).toString();
			sendWebhook(url, candidate, body);
		});
}

function sendWebhook(url: string, candidate: Candidate, body: string): void {

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
		.then(async (res) => {
			if (!res.ok) {
				console.error(`[webhook] non-2xx response: ${res.status} ${res.statusText}`);
				return;
			}
			console.log(`[webhook] delivered candidate.created for ${candidate.name}`);

			// receive_candidate returns {"message": "<Frappe Candidate name>"}.
			try {
				const parsed = JSON.parse(await res.text());
				const frappeCandidate = typeof parsed?.message === "string" ? parsed.message : null;
				if (frappeCandidate) {
					const fresh = await store.get(candidate.name);
					if (fresh) {
						fresh.frappe_candidate = frappeCandidate;
						await store.update(fresh);
					}
				}
			} catch (err) {
				console.error(`[webhook] could not parse Frappe candidate name: ${(err as Error).message}`);
			}
		})
		.catch((err) => {
			console.error(`[webhook] delivery failed: ${(err as Error).message}`);
		})
		.finally(() => clearTimeout(timeout));
}
