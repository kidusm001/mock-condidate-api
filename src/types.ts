export type ResolvedPlace = {
	place_id: string | null;
	display_name: string | null;
	formatted_address: string | null;
	lat: number | null;
	lng: number | null;
};

export type ReservationState = {
	status: "Ready for Reservation" | "Requested" | "Failed";
	matched_route: string | null;
	frappe_candidate: string | null;
	notified_at: string;
	requested_at: string | null;
	response: unknown;
};

export type Candidate = {
	name: string;
	candidate_name: string;
	id: string | null;
	phone: string | null;
	dropoff_location: string;
	dropoff_place: ResolvedPlace | null;
	created_at: string;
	reservation: ReservationState | null;
	/** Frappe's Candidate.name, learned from the receive_candidate webhook response. */
	frappe_candidate: string | null;
	priority: boolean;
};

export type ReadyForReservationPayload = {
	external_request_id?: string | null;
	candidate?: string | null;
	candidate_name?: string | null;
	matched_route?: string | null;
	state?: string | null;
};

export type ReceiveCandidateRequest = {
	candidate_name?: string | null;
	phone?: string | null;
	id?: string | null;
	dropoff_location?: string | null;
	priority?: boolean | null;
};

export type ErrorResponse = {
	error: string;
	message: string;
};

export type ListResponse = {
	data: Candidate[];
};
