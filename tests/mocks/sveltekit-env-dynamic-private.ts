/**
 * Stand-in for SvelteKit's `$env/dynamic/private` virtual module.
 *
 * The real module is provided by the SvelteKit Vite plugin at build/dev time
 * and isn't resolvable under plain `vitest run`. Server modules that only
 * read `env.SOME_VAR` at import time (e.g. `src/lib/server/ai-config.ts`)
 * can be unit tested by aliasing `$env/dynamic/private` to this stub (see
 * `vitest.config.ts`), which just forwards to `process.env` — so a test can
 * set `process.env.SOME_VAR` before importing the module under test.
 */
export const env: Record<string, string | undefined> = process.env;
