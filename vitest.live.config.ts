import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Config for LIVE integration tests only (tests/integration/**).
 *
 * These tests talk to a real, operator-configured NocoDB instance and create/delete
 * real records. They are intentionally excluded from vitest.config.ts (the default
 * `npm test` suite and CI) and must be run explicitly via `npm run test:live` with
 * NOCODB_LIVE_TEST=1 plus NOCODB_URL / NOCODB_API_TOKEN / NOCODB_BASE_ID set in the
 * environment. See tests/integration/live-mcp.test.ts for details.
 */
export default defineConfig({
	test: {
		include: ['tests/integration/**/*.test.ts'],
	},
	resolve: {
		alias: {
			'$lib': path.resolve(__dirname, 'src/lib')
		}
	}
});
