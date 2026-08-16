import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		// Live integration tests hit a real, operator-configured NocoDB instance and
		// must never run as part of the default suite / CI. Use `npm run test:live`
		// (see vitest.live.config.ts) to run them explicitly and deliberately.
		exclude: ['tests/integration/**'],
	},
	resolve: {
		alias: {
			'$lib': path.resolve(__dirname, 'src/lib')
		}
	}
});
