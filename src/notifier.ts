import type {
	ChangeResult,
	Config,
	NotificationChannel,
	NotificationPayload,
	NtfyChannel,
	Snapshot,
	WebhookChannel,
	Website,
} from "./types";
import {
	filenameFromUrlAndName,
	formatTimestamp,
	TRUNCATION_LIMITS,
} from "./utils";

const priorityMap: Record<Website["priority"], number> = {
	urgent: 5,
	high: 4,
	default: 3,
	low: 2,
	min: 1,
} as const;

/**
 * Render template string with payload values
 * Replaces {{placeholder}} with corresponding payload values
 */
function renderTemplate(
	template: string,
	payload: NotificationPayload,
): string {
	const variables: Record<string, string> = {
		title: payload.title,
		message: payload.message,
		url: payload.url,
		name: payload.name,
		priority: payload.priority,
		priority_num: String(payload.priorityNum),
		tags: payload.tags.join(","),
		timestamp: payload.timestamp,
		event: payload.event,
		hash: payload.hash ?? "",
		diff: payload.diff ?? "",
	};

	return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
		return variables[key] ?? match;
	});
}

/**
 * Look up a channel by name from the config
 */
function getChannelByName(name: string, config: Config): NotificationChannel {
	const channel = config.channels?.[name];
	if (!channel) {
		throw new Error(
			`Unknown notification channel: "${name}". Make sure it's defined in the 'channels' section of your config.`,
		);
	}
	return channel;
}

/**
 * Resolve notifiers for a website
 * Returns array of NotificationChannel objects (empty array if no notifiers configured)
 */
function resolveNotifiers(
	website: Website,
	config: Config,
): NotificationChannel[] {
	// If no notifiers specified, use default_channel from settings (or empty array)
	if (!website.notifiers || website.notifiers.length === 0) {
		const defaultChannel = config.settings.default_channel;
		if (!defaultChannel) {
			return []; // No notifications configured - silently skip
		}
		return [getChannelByName(defaultChannel, config)];
	}

	return website.notifiers.map((notifier) => {
		// If it's a string, look up in named channels
		if (typeof notifier === "string") {
			return getChannelByName(notifier, config);
		}
		// Otherwise it's an inline channel definition
		return notifier;
	});
}

/**
 * Send notification to a single channel
 */
async function sendToChannel(
	channel: NotificationChannel,
	payload: NotificationPayload,
): Promise<void> {
	if (channel.type === "ntfy") {
		await sendNtfyNotification(channel, payload);
	} else if (channel.type === "webhook") {
		await sendWebhookNotification(channel, payload);
	} else {
		// TypeScript exhaustive check
		const _exhaustive: never = channel;
		throw new Error(
			`Unknown channel type: ${(_exhaustive as NotificationChannel).type}`,
		);
	}
}

/**
 * Send notification to all resolved channels in parallel
 */
async function sendToAllChannels(
	channels: NotificationChannel[],
	payload: NotificationPayload,
): Promise<void> {
	if (channels.length === 0) {
		return; // No channels configured - silently skip
	}

	const results = await Promise.allSettled(
		channels.map((channel) => sendToChannel(channel, payload)),
	);

	// Log any failures
	const failures = results.filter(
		(r): r is PromiseRejectedResult => r.status === "rejected",
	);

	if (failures.length > 0) {
		for (const failure of failures) {
			console.error("Channel notification failed:", failure.reason);
		}
		// Only throw if ALL channels failed
		if (failures.length === results.length && failures.length > 0) {
			throw new Error(
				`All ${failures.length} notification channels failed. First error: ${failures[0]?.reason}`,
			);
		}
		console.warn(
			`${failures.length}/${results.length} notification channels failed`,
		);
	}
}

/**
 * Check if error notification should be sent based on throttling rules
 */
function shouldSendErrorNotification(
	errorCount: number,
	lastNotificationTime: number,
	{ config }: { config: Config },
): { shouldNotify: boolean; reason?: string } {
	const threshold = config.settings.error_notification_threshold;
	const cooldown = config.settings.error_notification_cooldown_ms;
	const timeSinceLastNotification = Date.now() - lastNotificationTime;

	const shouldNotify =
		errorCount >= threshold && timeSinceLastNotification >= cooldown;

	if (!shouldNotify) {
		if (errorCount < threshold) {
			return {
				shouldNotify: false,
				reason: `error count: ${errorCount}/${threshold}`,
			};
		}
		const remainingCooldown = Math.ceil(
			(cooldown - timeSinceLastNotification) / 60000,
		);
		return {
			shouldNotify: false,
			reason: `cooldown: ${remainingCooldown} minutes remaining`,
		};
	}

	return { shouldNotify: true };
}

/**
 * Send change notification
 */
export async function sendChangeNotification(
	result: ChangeResult,
	website: Website,
	{ config }: { config: Config },
): Promise<void> {
	let title: string;
	let message: string;

	if (result.isFirstRun) {
		title = `✅ Initial snapshot: ${result.name}`;
		message =
			`Initial snapshot created for ${result.url}\n` +
			`Content hash: ${result.newHash}\n` +
			`Timestamp: ${new Date().toISOString()}`;
	} else {
		title = `📢 Change detected: ${result.name}`;
		const filename = filenameFromUrlAndName(result.url, result.name);
		const baseMessage =
			`Changes detected at ${new Date().toISOString()}\n` +
			`Snapshot: snapshots/${filename}`;

		// Only include diff if it fits within message size limit
		if (result.diff) {
			const fullMessage = `${baseMessage}\n\n${result.diff}`;
			if (fullMessage.length <= TRUNCATION_LIMITS.MAX_MESSAGE_SIZE) {
				message = fullMessage;
			} else {
				message = `${baseMessage}\n\n(Diff too large to include in notification)`;
			}
		} else {
			message = baseMessage;
		}
	}

	const payload: NotificationPayload = {
		title,
		message,
		url: result.url,
		name: result.name,
		priority: website.priority,
		priorityNum: priorityMap[website.priority] ?? priorityMap.default,
		tags: [
			...(website.tags ?? []),
			"changedetection",
			result.isFirstRun ? "initial" : "changed",
		],
		timestamp: new Date().toISOString(),
		event: result.isFirstRun ? "initial" : "change",
		hash: result.newHash,
		diff: result.diff,
	};

	const channels = resolveNotifiers(website, config);
	await sendToAllChannels(channels, payload);
}

/**
 * Send error notification with throttling
 * @returns Updated snapshot with last_error_notification_time set if notification was sent, or null if throttled
 */
export async function sendErrorNotification(
	website: Website,
	error: Error,
	snapshot: Snapshot | null,
	{ config }: { config: Config },
): Promise<Snapshot | null> {
	const errorCount = snapshot?.error_count ?? 0;
	const lastNotificationTime = snapshot?.last_error_notification_time ?? 0;

	const { shouldNotify, reason } = shouldSendErrorNotification(
		errorCount,
		lastNotificationTime,
		{ config },
	);

	if (!shouldNotify) {
		console.log(`Skipping error notification for ${website.name} (${reason})`);
		return null;
	}

	const title = `❌ Failed to fetch: ${website.name}`;
	const message =
		`Failed to fetch ${website.url}\n\n` +
		`Error: ${error.message}\n` +
		`Timestamp: ${formatTimestamp(new Date())}`;

	const payload: NotificationPayload = {
		title,
		message,
		url: website.url,
		name: website.name,
		priority: "urgent",
		priorityNum: priorityMap.urgent,
		tags: [...(website.tags ?? []), "error"],
		timestamp: new Date().toISOString(),
		event: "error",
	};

	const channels = resolveNotifiers(website, config);
	await sendToAllChannels(channels, payload);

	// Return updated snapshot with notification time
	if (snapshot) {
		return {
			...snapshot,
			last_error_notification_time: Date.now(),
		};
	}
	return null;
}

/**
 * Send ntfy.sh notification
 */
async function sendNtfyNotification(
	channel: NtfyChannel,
	payload: NotificationPayload,
): Promise<void> {
	const params = {
		topic: channel.topic,
		title: payload.title,
		priority: payload.priorityNum,
		message: payload.message,
		tags: payload.tags,
		click: payload.url,
	};

	try {
		const response = await fetch(channel.server, {
			method: "POST",
			body: JSON.stringify(params),
		});

		if (!response.ok) {
			throw new Error(
				`ntfy.sh returned ${response.status}: ${response.statusText}`,
			);
		}

		console.log(`✅ Notification sent (ntfy): ${payload.title}`);
	} catch (error) {
		console.error("Failed to send ntfy notification:", error);
		throw error;
	}
}

/**
 * Send webhook notification
 */
async function sendWebhookNotification(
	channel: WebhookChannel,
	payload: NotificationPayload,
): Promise<void> {
	const method = channel.method ?? "POST";
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...channel.headers,
	};

	// Render body template, or use default JSON payload
	let body: string | undefined;
	if (method !== "GET") {
		if (channel.body) {
			body = renderTemplate(channel.body, payload);
		} else {
			// Default body if none specified
			body = JSON.stringify({
				title: payload.title,
				message: payload.message,
				url: payload.url,
				name: payload.name,
				priority: payload.priority,
				tags: payload.tags,
				timestamp: payload.timestamp,
				event: payload.event,
			});
		}
	}

	// Render URL template (for dynamic URLs)
	const url = renderTemplate(channel.url, payload);

	try {
		const response = await fetch(url, {
			method,
			headers,
			body,
		});

		if (!response.ok) {
			throw new Error(
				`Webhook returned ${response.status}: ${response.statusText}`,
			);
		}

		console.log(`✅ Notification sent (webhook): ${payload.title}`);
	} catch (error) {
		console.error(`Failed to send webhook notification to ${url}:`, error);
		throw error;
	}
}
