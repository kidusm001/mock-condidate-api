export type ResolvedPlace = {
	place_id: string | null;
	display_name: string | null;
	formatted_address: string | null;
	lat: number | null;
	lng: number | null;
};

export type Candidate = {
	name: string;
	candidate_name: string;
	id: string | null;
	phone: string | null;
	dropoff_location: string;
	dropoff_place: ResolvedPlace | null;
	created_at: string;
};

export type ReceiveCandidateRequest = {
	candidate_name?: string | null;
	phone?: string | null;
	id?: string | null;
	dropoff_location?: string | null;
};

export type ErrorResponse = {
	error: string;
	message: string;
};

export type ListResponse = {
	data: Candidate[];
};
