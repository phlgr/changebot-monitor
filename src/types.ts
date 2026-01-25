export type Config = {
	channels?: ChannelsConfig;
	settings: GlobalSettings;
	websites: Website[];
};

// Notification channel types
export type NtfyChannel = {
	type: "ntfy";
	topic: string;
	server: string;
};

export type WebhookChannel = {
	type: "webhook";
	url: string;
	method?: "GET" | "POST" | "PUT" | "PATCH";
	headers?: Record<string, string>;
	body?: string; // Template string with {{placeholders}}
};

export type NotificationChannel = NtfyChannel | WebhookChannel;

// Named channels configuration
export type ChannelsConfig = Record<string, NotificationChannel>;

// Notifier reference: either a named channel (string) or inline definition
export type Notifier = string | NotificationChannel;

// Internal payload for template rendering
export type NotificationPayload = {
	title: string;
	message: string;
	url: string;
	name: string;
	priority: Website["priority"];
	priorityNum: number;
	tags: string[];
	timestamp: string;
	event: "change" | "error" | "initial";
	hash?: string;
	diff?: string;
};

export type GlobalSettings = {
	timeout: number;
	retries: number;
	large_content_threshold: number;
	error_notification_threshold: number; // Only notify after this many consecutive errors
	error_notification_cooldown_ms: number; // Cooldown between error notifications
	default_channel?: string; // Default channel name when website doesn't specify notifiers
};

export type Website = {
	name: string;
	url: string;
	selector?: string | null;
	enabled: boolean;
	priority: "default" | "urgent" | "high" | "low" | "min";
	tags?: string[];
	notifyOnFirstRun?: boolean; // Whether to send notification on initial snapshot (default: true)
	notifiers?: Notifier[]; // Custom notifiers for this website (uses default channel if not specified)
};

export type Snapshot = {
	url: string;
	name: string;
	current: SnapshotEntry;
	previous?: SnapshotEntry;
	last_check: string;
	change_count: number;
	error_count: number;
	enabled: boolean;
	selector?: string | null;
	last_error_notification_time?: number; // Timestamp of last error notification (for throttling)
};

export type SnapshotEntry = {
	timestamp: string;
	content: string;
	hash: string;
	status: number;
};

export type ChangeResult = {
	url: string;
	name: string;
	changed: boolean;
	isFirstRun: boolean;
	oldHash?: string;
	newHash?: string;
	diff?: string;
	error?: string;
};

export type FetchResult = {
	content: string;
	status: number;
	error?: string;
};
