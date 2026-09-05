<script lang="ts">
	import '../app.css';
	import Icon from '@iconify/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { refresh, dataStore, refreshing, doRefresh } from '$lib/stores/data.svelte';
	import { homeContext, initHomeContext } from '$lib/stores/home-context.svelte';
	import { setContext as setChatContext } from '$lib/stores/chat.svelte';
	import { onMount } from 'svelte';
	import { Toaster } from 'svelte-sonner';
	import IosPwaNudge from '$lib/components/ui/IosPwaNudge.svelte';
	import AskOhmIcon from '$lib/components/icons/AskOhmIcon.svelte';

	let { children, data } = $props();

	const onSettingsPage = $derived(page.url.pathname.startsWith('/settings'));

	function toggleSettings() {
		if (onSettingsPage) {
			// Leaving settings: return to prior page if there's local history, else home
			if (window.history.length > 1) {
				window.history.back();
			} else {
				goto('/');
			}
		} else {
			goto('/settings');
		}
	}

	let homeDropdownOpen = $state(false);

	// Relative time display (updates every 30s)
	let now = $state(Date.now());
	let intervalId: ReturnType<typeof setInterval>;
	onMount(() => {
		intervalId = setInterval(() => { now = Date.now(); }, 30000);
		return () => clearInterval(intervalId);
	});

	// Initialize home context as soon as the home list arrives so other
	// homepage sections can populate independently.
	$effect(() => {
		if (dataStore.loadedTables.homes) initHomeContext();
	});

	// Keep chat context in sync with current page and home selection
	$effect(() => {
		const url = page.url;
		if (!url) return;
		const params = url.searchParams;
		setChatContext({
			currentRoute: url.pathname,
			selectedHomeId: homeContext.selectedHomeId ?? undefined,
			selectedHomeName: homeContext.selectedHomeName || undefined,
			selectedPanel: params.get('panel') || undefined,
			selectedCircuit: params.get('circuit') || undefined,
			selectedRoom: params.get('area') || params.get('room') || undefined
		});
	});

	function relativeTime(ts: number | null): string {
		if (!ts) return '';
		const diff = Math.max(0, now - ts);
		if (diff < 60000) return 'just now';
		const mins = Math.floor(diff / 60000);
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		return `${hrs}h ago`;
	}

	// Pull-to-refresh state
	let pullY = $state(0);
	let pulling = $state(false);
	let startY = 0;
	let startScrollTop = 0;
	const THRESHOLD = 64;

	function onTouchStart(e: TouchEvent) {
		const scrollable = document.scrollingElement || document.documentElement;
		startScrollTop = scrollable.scrollTop;
		if (startScrollTop <= 0) {
			startY = e.touches[0].clientY;
			pulling = true;
		}
	}

	function onTouchMove(e: TouchEvent) {
		if (!pulling || refreshing.value) return;
		const dy = e.touches[0].clientY - startY;
		if (dy > 0 && startScrollTop <= 0) {
			pullY = Math.min(dy * 0.4, 100);
		} else {
			pullY = 0;
		}
	}

	async function onTouchEnd() {
		if (!pulling) return;
		pulling = false;
		if (pullY >= THRESHOLD) {
			await doRefresh();
		}
		pullY = 0;
	}

	const navItems = $derived.by(() => [
		{ href: '/', label: 'Home', icon: 'mdi:home', activeColor: 'text-accent' },
		{ href: '/rooms', label: 'Rooms', icon: 'lucide:layout-panel-left', activeColor: 'text-[#A78BFA]' },
		{ href: '/panels', label: 'Panels', icon: 'mdi:transmission-tower', activeColor: 'text-[#F5A623]' },
		{ href: '/devices', label: 'Devices', icon: 'mdi:devices', activeColor: 'text-[#E879F9]' },
		{ href: '/energy', label: 'Energy', icon: 'mdi:lightning-bolt', activeColor: 'text-[#22D3EE]' },
		...(data.aiEnabled
			? [{ href: '/chat', label: 'Ask Ωhm', icon: 'mdi:chat-processing-outline', activeColor: 'text-accent' }]
			: [])
	]);
</script>

<svelte:head>
	<title>Ωhm</title>
	<meta name="description" content="Ωhm — AI-powered home electrical intelligence" />
	<meta name="theme-color" content="#0f0f1a" />
</svelte:head>

<!-- Close home dropdown on outside click -->
{#if homeDropdownOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[9]" onclick={() => homeDropdownOpen = false}></div>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex flex-col min-h-screen bg-surface-base text-fg"
	style="-webkit-font-smoothing: antialiased"
	ontouchstart={onTouchStart}
	ontouchmove={onTouchMove}
	ontouchend={onTouchEnd}
>
	<!-- Pull-to-refresh indicator -->
	{#if pullY > 0 || refreshing.value}
		<div
			class="fixed top-0 left-0 right-0 flex justify-center z-50 pointer-events-none transition-transform duration-200"
			style="transform: translateY({refreshing.value ? 16 : pullY - 32}px)"
		>
			<div class="w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center shadow-lg">
				<Icon
					icon={refreshing.value ? 'mdi:loading' : 'mdi:arrow-down'}
					width={18}
					class="{refreshing.value ? 'animate-spin' : ''} text-accent-fg transition-transform duration-150"
					style="transform: rotate({!refreshing.value && pullY >= THRESHOLD ? '180deg' : '0deg'})"
				/>
			</div>
		</div>
	{/if}

	<main class="flex-1 pb-20 px-4 pt-4 relative" style="padding-top: calc(env(safe-area-inset-top, 0px) + 1rem)">
		<!-- Offline banner -->
		{#if dataStore.offline}
			<div class="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-energy-subtle border border-[#F5A623]/30 text-[#F5A623] text-[11px]">
				<Icon icon="mdi:wifi-off" width={14} />
				<span>Offline — showing data from {relativeTime(dataStore.lastFetchedAt)}</span>
			</div>
		{/if}
		<!-- Top-right actions: home switcher + refresh + settings -->
		{#if dataStore.loaded}
			<div class="absolute right-4 flex items-center gap-2.5 z-10" style="top: calc(env(safe-area-inset-top, 0px) + 1rem)">
				{#if homeContext.hasMultipleHomes}
					<div class="relative">
						<button
							onclick={() => homeDropdownOpen = !homeDropdownOpen}
							class="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors bg-slate-800/60 border border-slate-700/50 rounded-md px-2 py-1"
						>
							<Icon icon="mdi:home-outline" width={12} />
							<span class="max-w-[80px] truncate">{homeContext.selectedHomeName || 'Home'}</span>
							<Icon icon="mdi:chevron-down" width={12} class="opacity-60" />
						</button>
						{#if homeDropdownOpen}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="absolute top-full right-0 mt-1 bg-slate-800 border border-slate-600/50 rounded-lg shadow-xl overflow-hidden min-w-[140px]"
								onclick={(e) => e.stopPropagation()}
							>
								{#each homeContext.homes as home (home.id)}
									<button
										onclick={() => { homeContext.selectedHomeId = home.id; homeDropdownOpen = false; }}
										class="w-full text-left px-3 py-2 text-[12px] transition-colors flex items-center gap-2
											{home.id === homeContext.selectedHomeId ? 'bg-accent-subtle/30 text-accent-fg' : 'text-slate-300 hover:bg-slate-700/50'}"
									>
										<Icon icon={home.id === homeContext.selectedHomeId ? 'mdi:home' : 'mdi:home-outline'} width={14} />
										{home.fields.Name || `Home #${home.id}`}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
				<button
					onclick={doRefresh}
					disabled={refreshing.value}
					class="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
					title="Tap to refresh"
				>
					<Icon icon="mdi:refresh" width={12} class="{refreshing.value ? 'animate-spin' : ''}" />
					<span>{refreshing.value ? 'Refreshing…' : relativeTime(dataStore.lastFetchedAt)}</span>
				</button>
				<button
					onclick={toggleSettings}
					class="flex items-center justify-center w-8 h-8 rounded-lg transition-colors {onSettingsPage ? 'text-accent-fg bg-accent-subtle hover:bg-accent-subtle' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}"
					title={onSettingsPage ? 'Close settings' : 'Settings'}
					aria-label={onSettingsPage ? 'Close settings' : 'Settings'}
				>
					<Icon icon={onSettingsPage ? 'mdi:close' : 'mdi:cog-outline'} width={18} />
				</button>
			</div>
		{/if}
		{@render children()}
	</main>

	<nav class="fixed bottom-0 inset-x-0 bg-slate-800/95 backdrop-blur-sm border-t border-slate-700 px-2 pt-2 flex justify-around z-30" style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom))">
		{#each navItems as item}
			{@const active = page.url.pathname === item.href || (item.href !== '/' && page.url.pathname.startsWith(item.href))}
			<a
				href={item.href}
				class="flex flex-col items-center gap-0.5 text-xs min-w-[44px] min-h-[44px] justify-center rounded-lg transition-color,opacity {active ? item.activeColor : 'text-slate-400 hover:text-white'}"
			>
				{#if item.href === '/chat'}
					<AskOhmIcon size={22} />
				{:else}
					<Icon icon={item.icon} width={22} />
				{/if}
				<span class="font-medium">{item.label}</span>
			</a>
		{/each}
	</nav>

	<Toaster theme="dark" position="top-center" richColors closeButton />
	<IosPwaNudge />
</div>
