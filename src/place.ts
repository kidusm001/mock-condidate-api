import type { ResolvedPlace } from "./types.ts";

const TIMEOUT_MS = 5000;

const EMPTY_PLACE: ResolvedPlace = {
	place_id: null,
	display_name: null,
	formatted_address: null,
	lat: null,
	lng: null,
};

type PlacesApiNewResponse = {
	places?: Array<{
		id?: string;
		displayName?: { text?: string; languageCode?: string };
		formattedAddress?: string;
		location?: { latitude?: number; longitude?: number };
	}>;
};

export async function resolvePlace(rawText: string): Promise<ResolvedPlace> {
	const key = process.env.GOOGLE_API_KEY;
	if (!key) {
		return EMPTY_PLACE;
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Goog-Api-Key": key,
				"X-Goog-FieldMask":
					"places.id,places.displayName,places.formattedAddress,places.location",
			},
			body: JSON.stringify({ textQuery: rawText }),
			signal: controller.signal,
		});
		if (!res.ok) {
			console.warn(`[place] Google API non-2xx: ${res.status} ${res.statusText}`);
			return EMPTY_PLACE;
		}
		const data = (await res.json()) as PlacesApiNewResponse;
		const first = data.places?.[0];
		if (!first) {
			console.warn(`[place] no results for "${rawText}"`);
			return EMPTY_PLACE;
		}
		return {
			place_id: first.id ?? null,
			display_name: first.displayName?.text ?? null,
			formatted_address: first.formattedAddress ?? null,
			lat: first.location?.latitude ?? null,
			lng: first.location?.longitude ?? null,
		};
	} catch (err) {
		console.warn(`[place] Google API call failed: ${(err as Error).message}`);
		return EMPTY_PLACE;
	} finally {
		clearTimeout(timeout);
	}
}
