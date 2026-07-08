import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Electrical Config',
				short_name: 'Electrical',
				description: 'Home electrical configuration lookup and AI assistant',
				theme_color: '#1e293b',
				background_color: '#0f172a',
				display: 'standalone',
				icons: [
					{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
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
