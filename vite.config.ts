import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Ωhm',
				short_name: 'Ωhm',
				description: 'Ωhm — AI-powered home electrical intelligence',
				theme_color: '#6366F1',
				background_color: '#0F0F1A',
				display: 'standalone',
				icons: [
					{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
					{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
				]
			},
			workbox: {
				runtimeCaching: [
					{
						urlPattern: /\/api\/nocodb\?action=records/,
						handler: 'NetworkFirst',
						options: {
							cacheName: 'nocodb-data',
							expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
							networkTimeoutSeconds: 5
						}
					},
					{
						urlPattern: /\/api\/image\?path=/,
						handler: 'CacheFirst',
						options: {
							cacheName: 'nocodb-images',
							expiration: { maxEntries: 100, maxAgeSeconds: 604800 }
						}
					}
				]
			}
		})
	]
});
