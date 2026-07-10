import type { Candidate } from "./types.ts";
import { seedCandidates } from "./seed.ts";

const DATA_DIR = new URL("../data/", import.meta.url);
const DATA_FILE = new URL("./candidates.json", DATA_DIR);

let cache: Candidate[] | null = null;

async function ensureDataDir(): Promise<void> {
	const dir = Bun.file(DATA_FILE);
	if (!(await dir.exists())) {
		await Bun.write(DATA_FILE, JSON.stringify(seedCandidates, null, 2));
	}
}

export async function load(): Promise<Candidate[]> {
	if (cache) return cache;
	await ensureDataDir();
	const file = Bun.file(DATA_FILE);
	const text = await file.text();
	const parsed = text.trim() ? (JSON.parse(text) as Candidate[]) : [];
	cache = parsed;
	return cache;
}

async function persist(candidates: Candidate[]): Promise<void> {
	cache = candidates;
	await Bun.write(DATA_FILE, JSON.stringify(candidates, null, 2));
}

export async function list(): Promise<Candidate[]> {
	const items = await load();
	return [...items];
}

export async function get(name: string): Promise<Candidate | undefined> {
	const items = await load();
	return items.find((c) => c.name === name);
}

export async function has(name: string): Promise<boolean> {
	const items = await load();
	return items.some((c) => c.name === name);
}

export async function findByExternalId(id: string): Promise<Candidate | undefined> {
	const items = await load();
	return items.find((c) => c.id === id);
}

export async function insert(candidate: Candidate): Promise<Candidate> {
	const items = await load();
	items.push(candidate);
	await persist(items);
	return candidate;
}

export async function update(candidate: Candidate): Promise<Candidate> {
	const items = await load();
	const idx = items.findIndex((c) => c.name === candidate.name);
	if (idx === -1) {
		throw new Error(`Candidate '${candidate.name}' not found`);
	}
	items[idx] = candidate;
	await persist(items);
	return candidate;
}

export async function reset(): Promise<Candidate[]> {
	const fresh = [...seedCandidates];
	await persist(fresh);
	return fresh;
}
