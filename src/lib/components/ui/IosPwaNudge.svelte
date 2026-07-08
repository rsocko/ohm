<!--
  IosPwaNudge.svelte — Dismissable banner nudging iOS Safari users to open in PWA.
  Only shows when: iOS + in-browser (not standalone) + deep-link URL detected.
  Persists dismissal in localStorage.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';

	const STORAGE_KEY = 'pwa-nudge-dismissed';

	let visible = $state(false);

	onMount(() => {
		// Only show on iOS in-browser with deep-link params
		const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
		const isStandalone = window.matchMedia('(display-mode: standalone)').matches
			|| (navigator as any).standalone === true;
		const hasDeepLink = window.location.search.includes('panel=')
			|| window.location.search.includes('circuit=')
			|| window.location.search.includes('device=');
		const dismissed = localStorage.getItem(STORAGE_KEY);

		if (isIos && !isStandalone && hasDeepLink && !dismissed) {
			visible = true;
		}
	});

	function dismiss() {
		visible = false;
		localStorage.setItem(STORAGE_KEY, Date.now().toString());
	}
</script>

{#if visible}
	<div
		class="fixed bottom-4 left-4 right-4 z-[60] flex items-start gap-3 px-4 py-3 rounded-2xl bg-slate-800/95 backdrop-blur-md border border-slate-700/60 shadow-lg shadow-black/30"
		style="animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
	>
		<Icon icon="mdi:cellphone-arrow-down" class="w-6 h-6 text-blue-400 shrink-0 mt-0.5" />
		<div class="flex-1 min-w-0">
			<p class="text-sm font-medium text-white">Open in Home Electrical app</p>
			<p class="text-xs text-slate-400 mt-0.5">Add to Home Screen for the best experience — tap <Icon icon="mdi:export-variant" class="inline w-3.5 h-3.5 text-blue-400" /> then "Add to Home Screen"</p>
		</div>
		<button
			type="button"
			onclick={dismiss}
			class="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 active:scale-[0.96] transition-colors"
			aria-label="Dismiss"
		>
			<Icon icon="mdi:close" class="w-4 h-4" />
		</button>
	</div>
{/if}

<style>
	@keyframes slideUp {
		from { opacity: 0; transform: translateY(12px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
