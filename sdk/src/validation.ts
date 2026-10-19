import { ConfigurationError } from "./errors.js";

/**
 * Checks that an option is an integer within bounds.
 *
 * @param name Option name, used in the error message.
 * @param value The value the caller passed.
 * @param min Smallest allowed value.
 * @param max Largest allowed value.
 * @returns The value.
 * @throws {ConfigurationError} When the value is not an integer from `min` to `max`.
 */
export function integerIn(name: string, value: number, min: number, max: number): number {
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new ConfigurationError("configuration_error", `${name} must be an integer from ${min} to ${max}`);
	}
	return value;
}

/**
 * Checks that a webhook secret is not empty.
 *
 * @param secret The secret the caller passed.
 * @returns The secret.
 * @throws {ConfigurationError} When the secret is an empty string.
 */
export function nonEmptySecret(secret: string): string {
	if (secret === "") {
		throw new ConfigurationError("configuration_error", "The webhook secret must not be empty");
	}
	return secret;
}
