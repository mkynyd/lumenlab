/**
 * Centralized feature flags and runtime configuration.
 *
 * Values here are intentionally static defaults. Override them via environment
 * variables for containerized deployments, or edit the source directly for
 * local development forks.
 */

/**
 * Enable the "bring your own API key" self-hosting mode.
 *
 * When enabled, the app will first look for a user-level `ApiKey` record for
 * the requested provider. If none exists, it falls back to the centrally
 * managed `CredentialProfile` (the default Alpha registration flow).
 *
 * Developers can toggle this in code (0/1 style) or via the environment:
 *   USER_API_KEYS_ENABLED=1
 *
 * No frontend UI exposes this switch, so normal users cannot accidentally
 * change the deployment mode.
 */
export const USER_API_KEYS_ENABLED =
  process.env.USER_API_KEYS_ENABLED === "1" ||
  process.env.USER_API_KEYS_ENABLED === "true";
