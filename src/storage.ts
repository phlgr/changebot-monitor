import * as fs from "node:fs";
import * as path from "node:path";
import type { Snapshot } from "./types";
import { filenameFromUrlAndName } from "./utils";

const SNAPSHOTS_DIR = "./snapshots";

/**
 * Get snapshot file path for URL
 */
function getSnapshotPath(url: string, name: string): string {
	const filename = filenameFromUrlAndName(url, name);
	return path.join(SNAPSHOTS_DIR, filename);
}

/**
 * Load existing snapshot or return null
 */
export function loadSnapshot(url: string, name: string): Snapshot | null {
	try {
		const snapshotPath = getSnapshotPath(url, name);
		if (!fs.existsSync(snapshotPath)) {
			return null;
		}

		const content = fs.readFileSync(snapshotPath, "utf-8");
		return JSON.parse(content) as Snapshot;
	} catch (error) {
		console.error(`Failed to load snapshot for ${url}:`, error);
		return null;
	}
}

/**
 * Save snapshot to file
 */
export function saveSnapshot(snapshot: Snapshot): void {
	try {
		const snapshotPath = getSnapshotPath(snapshot.url, snapshot.name);
		const dir = path.dirname(snapshotPath);

		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
	} catch (error) {
		console.error(`Failed to save snapshot for ${snapshot.url}:`, error);
		throw error;
	}
}
