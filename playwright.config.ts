import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: 'line',
	use: {
		baseURL: 'http://127.0.0.1:5181',
		trace: 'on-first-retry'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: {
		command: 'npm run dev -- --host 127.0.0.1 --port 5181 --strictPort',
		url: 'http://127.0.0.1:5181',
		reuseExistingServer: !process.env.CI
	}
});
