const TIMEOUT_MS = 8000;

/** Resolves a Frappe whitelisted method to a full URL, reusing WEBHOOK_URL's origin. */
export function frappeMethodUrl(method: string): string | null {
	const base = process.env.FRAPPE_BASE_URL ?? process.env.WEBHOOK_URL;
	if (!base) return null;
	try {
		const url = new URL(base);
		url.pathname = `/api/method/${method}`;
		url.search = "";
		return url.toString();
	} catch {
		return null;
	}
}

export type FrappeCallResult = {
	ok: boolean;
	status: number;
	body: unknown;
};

/** POSTs form-encoded params to a Frappe whitelisted method, authenticated with API_KEY. */
export async function callFrappeMethod(
	method: string,
	params: Record<string, string>,
): Promise<FrappeCallResult> {
	const url = frappeMethodUrl(method);
	if (!url) {
		throw new Error("no Frappe URL configured (set WEBHOOK_URL or FRAPPE_BASE_URL)");
	}

	const headers: Record<string, string> = {
		"Content-Type": "application/x-www-form-urlencoded",
	};
	const apiKey = process.env.API_KEY;
	if (apiKey) headers["Authorization"] = `token ${apiKey}`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const res = await fetch(url, {
			method: "POST",
			headers,
			body: new URLSearchParams(params).toString(),
			signal: controller.signal,
		});
		const text = await res.text();
		let body: unknown = text;
		try {
			body = JSON.parse(text);
		} catch {
			// leave as raw text
		}
		return { ok: res.ok, status: res.status, body };
	} finally {
		clearTimeout(timeout);
	}
}

/** Reads a Frappe Candidate's live `status` field, e.g. to check for "Approved". */
export async function getCandidateStatus(frappeCandidateName: string): Promise<string | null> {
	const base = process.env.FRAPPE_BASE_URL ?? process.env.WEBHOOK_URL;
	if (!base) return null;

	let url: URL;
	try {
		url = new URL(base);
	} catch {
		return null;
	}
	url.pathname = "/api/method/frappe.client.get_value";
	url.search = "";
	url.searchParams.set("doctype", "Candidate");
	url.searchParams.set("fieldname", "status");
	url.searchParams.set("filters", JSON.stringify({ name: frappeCandidateName }));

	const headers: Record<string, string> = {};
	const apiKey = process.env.API_KEY;
	if (apiKey) headers["Authorization"] = `token ${apiKey}`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const res = await fetch(url.toString(), { headers, signal: controller.signal });
		if (!res.ok) return null;
		const body = (await res.json()) as { message?: { status?: string } };
		return body.message?.status ?? null;
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}
