import { join } from "node:path";
import type { Config } from "../types";

function parseConfig(config: unknown) {
	return JSON.parse(
		JSON.stringify(config).replace(
			/\${([^:-]+)(?::([^}]+))?}/g,
			(_, key, defaultValue) => process.env[key] || defaultValue || "",
		),
	);
}

let __config: Config | undefined;
export const getConfig = async (): Promise<Config> => {
	if (__config) return __config;
	const config = await Bun.file(join(".", ".changebotrc.yml")).text();
	const parsedConfig = parseConfig(Bun.YAML.parse(config)) as Config;
	__config = parsedConfig;
	console.log(parsedConfig);
	return parsedConfig;
};
