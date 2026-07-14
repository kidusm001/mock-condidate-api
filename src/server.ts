import { httpError, jsonResponse } from "./errors.ts";
import { getCandidateStatus } from "./frappe.ts";
import { resolvePlace } from "./place.ts";
import { handleReadyForReservation, requestReservation } from "./reservation.ts";
import * as store from "./store.ts";
import type { Candidate, ReadyForReservationPayload, ReceiveCandidateRequest } from "./types.ts";
import { notifyCandidateCreated } from "./webhook.ts";

const ALLOWED_FIELDS = new Set([
	"candidate_name",
	"dropoff_location",
	"phone",
	"id",
]);

const PORT = Number(process.env.PORT ?? 8001);

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

function withCors(res: Response): Response {
	const headers = new Headers(res.headers);
	for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
	return new Response(res.body, { status: res.status, headers });
}

function corsPreflight(): Response {
	return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
	const contentType = req.headers.get("Content-Type") ?? "";
	if (contentType.includes("application/json")) {
		const text = await req.text();
		if (!text.trim()) return {};
		const parsed: unknown = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return {};
	}
	if (
		contentType.includes("application/x-www-form-urlencoded") ||
		contentType.includes("multipart/form-data")
	) {
		const form = await req.formData();
		const out: Record<string, unknown> = {};
		for (const [k, v] of form.entries()) out[k] = v;
		return out;
	}
	const text = await req.text();
	if (!text.trim()) return {};
	try {
		const parsed: unknown = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		const params = new URLSearchParams(text);
		const out: Record<string, unknown> = {};
		for (const [k, v] of params.entries()) out[k] = v;
		return out;
	}
	return {};
}

function parseQuery(url: URL): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of url.searchParams.entries()) out[k] = v;
	return out;
}

function validateReceiveCandidate(
	body: Record<string, unknown>,
): { ok: true; data: ReceiveCandidateRequest } | { ok: false; status: number; code: string; message: string } {
	for (const key of Object.keys(body)) {
		if (!ALLOWED_FIELDS.has(key)) {
			return {
				ok: false,
				status: 400,
				code: "ValidationError",
				message: `unknown field '${key}'`,
			};
		}
	}

	const candidate_name = body.candidate_name;
	if (candidate_name === undefined || candidate_name === null) {
		return {
			ok: false,
			status: 400,
			code: "ValidationError",
			message: "candidate_name is required",
		};
	}
	if (typeof candidate_name !== "string" || !candidate_name.trim()) {
		return {
			ok: false,
			status: 400,
			code: "ValidationError",
			message: "candidate_name is required",
		};
	}

	const dropoff_location = body.dropoff_location;
	if (dropoff_location === undefined || dropoff_location === null) {
		return {
			ok: false,
			status: 400,
			code: "ValidationError",
			message: "dropoff_location is required",
		};
	}
	if (typeof dropoff_location !== "string" || !dropoff_location.trim()) {
		return {
			ok: false,
			status: 400,
			code: "ValidationError",
			message: "dropoff_location is required",
		};
	}

	const phone = body.phone;
	if (phone !== undefined && phone !== null && typeof phone !== "string") {
		return {
			ok: false,
			status: 400,
			code: "ValidationError",
			message: "phone must be a string",
		};
	}

	const id = body.id;
	if (id !== undefined && id !== null && typeof id !== "string") {
		return {
			ok: false,
			status: 400,
			code: "ValidationError",
			message: "id must be a string",
		};
	}

	return {
		ok: true,
		data: {
			candidate_name: candidate_name.trim(),
			dropoff_location: dropoff_location.trim(),
			phone: phone === undefined || phone === null ? null : (phone as string).trim() || null,
			id: id === undefined || id === null ? null : (id as string).trim() || null,
		},
	};
}

async function handleReceiveCandidate(req: Request): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		const query = parseQuery(new URL(req.url));
		const parsed = await parseBody(req);
		body = { ...query, ...parsed };
	} catch (err) {
		return withCors(
			httpError(400, "ValidationError", `invalid request body: ${(err as Error).message}`),
		);
	}

	const validation = validateReceiveCandidate(body);
	if (!validation.ok) {
		return withCors(httpError(validation.status, validation.code, validation.message));
	}
	const data = validation.data;

	if (await store.has(data.candidate_name!)) {
		return withCors(
			httpError(409, "DuplicateCandidate", `Candidate '${data.candidate_name}' already exists`),
		);
	}

	const dropoff_place = await resolvePlace(data.dropoff_location!);

	const id = data.id ?? (await store.generateExternalId());

	const candidate: Candidate = {
		name: data.candidate_name!,
		candidate_name: data.candidate_name!,
		id,
		phone: data.phone ?? null,
		dropoff_location: data.dropoff_location!,
		dropoff_place,
		created_at: new Date().toISOString(),
		reservation: null,
		frappe_candidate: null,
	};
	await store.insert(candidate);
	notifyCandidateCreated(candidate);
	return withCors(jsonResponse(201, candidate));
}

async function handleList(): Promise<Response> {
	const items = await store.list();
	return withCors(jsonResponse(200, { data: items }));
}

async function handleGetOne(name: string): Promise<Response> {
	const candidate = await store.get(name);
	if (!candidate) {
		return withCors(httpError(404, "NotFound", `Candidate '${name}' not found`));
	}
	return withCors(jsonResponse(200, candidate));
}

function isReadyForReservationPayload(body: Record<string, unknown>): body is ReadyForReservationPayload {
	for (const key of Object.keys(body)) {
		const val = body[key];
		if (val !== null && val !== undefined && typeof val !== "string") return false;
	}
	return true;
}

function isAuthorizedReservationNotify(req: Request): boolean {
	const expected = process.env.EXTERNAL_RESERVATION_TOKEN;
	if (!expected) return true; // unset: auth check disabled (local dev default)

	const header = req.headers.get("Authorization") ?? "";
	const [scheme, token] = header.split(" ");
	return scheme === "token" && token === expected;
}

async function handleReadyForReservationPut(req: Request): Promise<Response> {
	if (!isAuthorizedReservationNotify(req)) {
		return withCors(httpError(401, "Unauthorized", "invalid or missing Authorization token"));
	}

	let body: Record<string, unknown>;
	try {
		body = await parseBody(req);
	} catch (err) {
		return withCors(
			httpError(400, "ValidationError", `invalid request body: ${(err as Error).message}`),
		);
	}

	if (!isReadyForReservationPayload(body)) {
		return withCors(httpError(400, "ValidationError", "payload fields must be strings"));
	}
	if (!body.external_request_id) {
		return withCors(httpError(400, "ValidationError", "external_request_id is required"));
	}

	const candidate = await handleReadyForReservation(body);
	if (!candidate) {
		return withCors(
			httpError(
				404,
				"NotFound",
				`No candidate found for external_request_id '${body.external_request_id}'`,
			),
		);
	}
	return withCors(jsonResponse(200, candidate));
}

async function handleFrappeStatus(idOrName: string): Promise<Response> {
	const candidate =
		(await store.get(idOrName)) ?? (await store.findByExternalId(idOrName));
	if (!candidate) {
		return withCors(httpError(404, "NotFound", `Candidate '${idOrName}' not found`));
	}
	if (!candidate.frappe_candidate) {
		return withCors(jsonResponse(200, { status: null }));
	}

	const status = await getCandidateStatus(candidate.frappe_candidate);
	return withCors(jsonResponse(200, { status }));
}

async function handleRequestReservation(idOrName: string): Promise<Response> {
	const candidate =
		(await store.get(idOrName)) ?? (await store.findByExternalId(idOrName));
	if (!candidate) {
		return withCors(httpError(404, "NotFound", `Candidate '${idOrName}' not found`));
	}

	try {
		const updated = await requestReservation(candidate);
		return withCors(jsonResponse(200, updated));
	} catch (err) {
		return withCors(
			httpError(502, "RequestReservationFailed", `request_reservation call failed: ${(err as Error).message}`),
		);
	}
}

async function handleReset(): Promise<Response> {
	const items = await store.reset();
	return withCors(jsonResponse(200, { data: items, reset: true }));
}

function handleHealth(): Response {
	return withCors(jsonResponse(200, { ok: true }));
}

function handleNotFound(): Response {
	return withCors(httpError(404, "NotFound", "route not found"));
}

async function handleStatic(path: string): Promise<Response> {
	const safePath = path.replace(/\.\./g, "");
	const servedPath = safePath === "/" ? "/index.html" : safePath;
	const filePath = new URL(`../public${servedPath}`, import.meta.url);
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		return handleNotFound();
	}
	const ext = servedPath.split(".").pop() ?? "";
	const contentType =
		ext === "html" ? "text/html; charset=utf-8" :
		ext === "css" ? "text/css; charset=utf-8" :
		ext === "js" ? "application/javascript; charset=utf-8" :
		ext === "json" ? "application/json" :
		"application/octet-stream";
	return withCors(new Response(file, { headers: { "Content-Type": contentType } }));
}

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		const path = url.pathname;

		if (req.method === "OPTIONS") return corsPreflight();

		if (path === "/health" && req.method === "GET") return handleHealth();

		if (path === "/api/method/receive_candidate") return handleReceiveCandidate(req);

		if (path === "/api/method/frappe.client.get_list" && req.method === "GET") {
			return handleList();
		}

		if (path === "/api/reset" && req.method === "POST") return handleReset();

		if (path === "/api/external/reservation" && req.method === "PUT") {
			return handleReadyForReservationPut(req);
		}

		if (path.startsWith("/api/resource/Candidate/")) {
			const name = decodeURIComponent(path.slice("/api/resource/Candidate/".length));
			if (req.method === "GET") return handleGetOne(name);
		}

		if (
			path.startsWith("/api/reservations/") &&
			path.endsWith("/request-reservation") &&
			req.method === "POST"
		) {
			const idOrName = decodeURIComponent(
				path.slice("/api/reservations/".length, -"/request-reservation".length),
			);
			return handleRequestReservation(idOrName);
		}

		if (
			path.startsWith("/api/candidates/") &&
			path.endsWith("/frappe-status") &&
			req.method === "GET"
		) {
			const idOrName = decodeURIComponent(
				path.slice("/api/candidates/".length, -"/frappe-status".length),
			);
			return handleFrappeStatus(idOrName);
		}

		if (path === "/" || !path.startsWith("/api/")) {
			return handleStatic(path);
		}

		return handleNotFound();
	},
});

console.log(`Listening on http://localhost:${server.port}`);
