import type { ErrorResponse } from "./types.ts";

export function httpError(status: number, code: string, message: string): Response {
	const body: ErrorResponse = { error: code, message };
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export function jsonResponse(status: number, data: unknown): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
