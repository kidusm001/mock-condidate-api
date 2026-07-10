import { callFrappeMethod } from "./frappe.ts";
import * as store from "./store.ts";
import type { Candidate, ReadyForReservationPayload, ReservationState } from "./types.ts";

function baseState(): ReservationState {
	return {
		status: "Ready for Reservation",
		matched_route: null,
		frappe_candidate: null,
		notified_at: new Date().toISOString(),
		requested_at: null,
		response: null,
	};
}

/** Handles Frappe's PUT notifying us a candidate is ready for reservation. */
export async function handleReadyForReservation(
	payload: ReadyForReservationPayload,
): Promise<Candidate | null> {
	const externalId = payload.external_request_id ?? null;
	if (!externalId) return null;

	const candidate = await store.findByExternalId(externalId);
	if (!candidate) return null;

	candidate.reservation = {
		...baseState(),
		matched_route: payload.matched_route ?? null,
		frappe_candidate: payload.candidate ?? null,
	};
	if (payload.candidate) candidate.frappe_candidate = payload.candidate;
	await store.update(candidate);

	if ((process.env.AUTO_CONFIRM_RESERVATION ?? "false").toLowerCase() === "true") {
		requestReservation(candidate).catch((err) => {
			console.error(`[reservation] auto-request failed: ${(err as Error).message}`);
		});
	}

	return candidate;
}

/** Calls Frappe's request_reservation, setting the candidate to 'Requested Reservation'. */
export async function requestReservation(candidate: Candidate): Promise<Candidate> {
	if (!candidate.id) {
		console.error(`[reservation] cannot request reservation for ${candidate.name}: no external id`);
		return candidate;
	}

	try {
		const result = await callFrappeMethod(
			"mmcy_fleet_management.api.dispatch.request_reservation",
			{ external_request_id: candidate.id },
		);

		candidate.reservation = {
			...(candidate.reservation ?? baseState()),
			status: result.ok ? "Requested" : "Failed",
			requested_at: new Date().toISOString(),
			response: result.body,
		};
		await store.update(candidate);

		if (!result.ok) {
			console.error(`[reservation] request_reservation non-2xx: ${result.status}`);
		} else {
			console.log(`[reservation] requested reservation for ${candidate.name}`);
		}
		return candidate;
	} catch (err) {
		candidate.reservation = {
			...(candidate.reservation ?? baseState()),
			status: "Failed",
			requested_at: new Date().toISOString(),
			response: { error: (err as Error).message },
		};
		await store.update(candidate);
		throw err;
	}
}
