<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import Icon from '@iconify/svelte';

	interface V3Record {
		id: number;
		fields: Record<string, unknown>;
	}

	let query = $state('');
	let results: Record<string, V3Record[]> = $state({});
	let loading = $state(false);
	let searched = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let inputEl: HTMLInputElement | undefined = $state();
	let typeFilter: string | null = $state(null);
	let recentSearches: string[] = $state([]);

	const RECENT_KEY = 'electrical-config-recent-searches';
	const MAX_RECENT = 5;

	// Category config
	const categoryConfig: Record<string, { icon: string; color: string; label: string }> = {
		'Circuit': { icon: 'lucide:plug-zap', color: 'text-emerald-400', label: 'Circuits' },
		'Area': { icon: 'mdi:floor-plan', color: 'text-purple-400', label: 'Rooms' },
		'Load': { icon: 'mdi:lightbulb-outline', color: 'text-amber-400', label: 'Loads' },
		'Receptacle': { icon: 'mdi:power-socket-us', color: 'text-blue-400', label: 'Receptacles' },
		'Panel': { icon: 'mdi:view-grid-outline', color: 'text-cyan-400', label: 'Panels' },
	};

	function getCategoryInfo(tableName: string) {
		return categoryConfig[tableName] || { icon: 'mdi:database', color: 'text-slate-400', label: tableName };
	}

	async function doSearch() {
		if (!query.trim()) {
			results = {};
			searched = false;
			return;
		}
		loading = true;
		searched = true;

		try {
			const resp = await fetch(`/api/nocodb?action=search&q=${encodeURIComponent(query.trim())}`);
			const data = await resp.json();
			results = data.results || {};
			// Save to recent searches
			saveRecent(query.trim());
		} catch {
			results = {};
		} finally {
			loading = false;
		}
	}

	function saveRecent(term: string) {
		const filtered = recentSearches.filter(s => s.toLowerCase() !== term.toLowerCase());
		recentSearches = [term, ...filtered].slice(0, MAX_RECENT);
		try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches)); } catch {}
	}

	function onInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(doSearch, 300);
	}

	function getDisplayName(record: V3Record): string {
		const f = record.fields;
		return (f['Display Name'] || f.Name || f.Title || f.Label || `#${record.id}`) as string;
	}

	function getSubtext(tableName: string, record: V3Record): string {
		const f = record.fields;
		if (tableName === 'Circuit') {
			const panel = f.Panel as { fields?: { Name?: string } } | undefined;
			const panelName = panel?.fields?.Name || '';
			const amps = f.Amps as number || '';
			const num = f.Number as number || '';
			return [panelName, num ? `#${num}` : '', amps ? `${amps}A` : ''].filter(Boolean).join(' · ');
		}
		if (tableName === 'Area') {
			const floor = (f.Floor as string) || '';
			return floor;
		}
		if (tableName === 'Load') {
			const type = (f['Device Type'] as string) || '';
			const area = f.Area as { fields?: { Name?: string } } | undefined;
			return [type, area?.fields?.Name].filter(Boolean).join(' · ');
		}
		if (tableName === 'Receptacle') {
			const type = (f['Receptacle Type'] as string) || '';
			const area = f.Area as { fields?: { Name?: string } } | undefined;
			return [type, area?.fields?.Name].filter(Boolean).join(' · ');
		}
		if (tableName === 'Panel') {
			const loc = (f.Location as string) || '';
			const size = (f['Service Size'] as string) || '';
			return [loc, size].filter(Boolean).join(' · ');
		}
		return '';
	}

	function getResultIcon(tableName: string, record: V3Record): string {
		if (tableName === 'Circuit') {
			const gfci = record.fields['GFCI Protected'] || record.fields.GFCI_Protected;
			if (gfci) return 'mdi:shield-check';
			const amps = record.fields.Amps as number || 0;
			if (amps >= 30) return 'lucide:plug-zap';
			return 'lucide:plug-zap';
		}
		if (tableName === 'Receptacle') {
			const type = (record.fields['Receptacle Type'] as string) || '';
			if (type.includes('Smart')) return 'mdi:home-automation';
			if (type.includes('Dimmer')) return 'mdi:brightness-6';
			return 'mdi:power-socket-us';
		}
		if (tableName === 'Load') {
			const type = (record.fields['Device Type'] as string) || '';
			if (type.includes('Light')) return 'mdi:ceiling-light';
			if (type.includes('Fan')) return 'mdi:ceiling-fan-light';
			if (type.includes('Camera')) return 'mdi:cctv';
			return 'mdi:lightbulb-outline';
		}
		return getCategoryInfo(tableName).icon;
	}

	function getLink(tableName: string, record: V3Record): string | null {
		if (tableName === 'Circuit') {
			const panel = record.fields.Panel as { id?: number } | undefined;
			if (panel?.id) return `/panels?panel=${panel.id}&circuit=${record.id}`;
		}
		if (tableName === 'Area') return `/rooms?area=${record.id}`;
		if (tableName === 'Panel') return `/panels?panel=${record.id}`;
		if (tableName === 'Receptacle' || tableName === 'Load') {
			const area = record.fields.Area as { id?: number } | undefined;
			if (area?.id) return `/rooms?area=${area.id}`;
		}
		return null;
	}

	// Total result count
	const totalResults = $derived(
		Object.values(results).reduce((sum, arr) => sum + arr.length, 0)
	);

	// Filtered results by type
	const filteredResults = $derived.by(() => {
		if (!typeFilter) return results;
		const filtered: Record<string, V3Record[]> = {};
		if (results[typeFilter]) filtered[typeFilter] = results[typeFilter];
		return filtered;
	});

	onMount(() => {
		inputEl?.focus();
		// Load recent searches
		try {
			const stored = localStorage.getItem(RECENT_KEY);
			if (stored) recentSearches = JSON.parse(stored);
		} catch {}
		// Check for ?type= param
		const urlParams = new URL(window.location.href).searchParams;
		const urlType = urlParams.get('type');
		if (urlType) {
			const typeMap: Record<string, string> = { circuit: 'Circuit', load: 'Load', receptacle: 'Receptacle', area: 'Area', panel: 'Panel' };
			typeFilter = typeMap[urlType] || null;
		}
		// Check for ?filter= param (deep link from homepage insights)
		const filterParam = urlParams.get('filter');
		if (filterParam) {
			const filterQueries: Record<string, string> = {
				untyped: 'loads missing type',
				orphaned: 'loads no room'
			};
			const presetQuery = filterQueries[filterParam];
			if (presetQuery) {
				query = presetQuery;
				doSearch();
			}
		}
	});
</script>

<div class="flex flex-col h-full max-w-2xl mx-auto">
	<!-- Sticky search header -->
	<div class="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm pb-3 pt-1 space-y-3 -mx-1 px-1">
		<!-- Search input -->
		<div class="relative" style="view-transition-name: search-bar">
			<Icon icon="mdi:magnify" width={18} class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
			<input
				bind:this={inputEl}
				type="text"
				bind:value={query}
				oninput={onInput}
				placeholder="Search circuits, rooms, devices…"
				class="w-full bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
			/>
			{#if query}
				<button
					onclick={() => { query = ''; results = {}; searched = false; inputEl?.focus(); }}
					class="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-slate-700 text-slate-500 hover:text-white transition-colors"
				>
					<Icon icon="mdi:close-circle" width={18} />
				</button>
			{/if}
		</div>

		<!-- Category filter chips (show when we have results) -->
		{#if searched && totalResults > 0}
			<div class="flex gap-1.5 overflow-x-auto pb-0.5 -mb-0.5">
				<button
					onclick={() => { typeFilter = null; }}
					class="shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors {!typeFilter ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}"
				>
					All ({totalResults})
				</button>
				{#each Object.entries(results) as [tableName, records]}
					{@const cat = getCategoryInfo(tableName)}
					<button
						onclick={() => { typeFilter = typeFilter === tableName ? null : tableName; }}
						class="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors {typeFilter === tableName ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}"
					>
						<Icon icon={cat.icon} width={12} class={typeFilter === tableName ? 'text-white' : cat.color} />
						{cat.label} ({records.length})
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Results -->
	<div class="flex-1 overflow-y-auto space-y-4 mt-1">
		{#if loading}
			<div class="flex justify-center py-12">
				<div class="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
			</div>
		{:else if !searched}
			<!-- Empty state: recent + suggestions -->
			<div class="py-8 space-y-6">
				{#if recentSearches.length > 0}
					<div>
						<h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2 px-1">Recent</h3>
						<div class="flex flex-wrap gap-2">
							{#each recentSearches as term}
								<button
									onclick={() => { query = term; doSearch(); }}
									class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50 text-xs text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
								>
									<Icon icon="mdi:history" width={12} class="text-slate-500" />
									{term}
								</button>
							{/each}
						</div>
					</div>
				{/if}
				<div>
					<h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2 px-1">Suggestions</h3>
					<div class="flex flex-wrap gap-2">
						{#each ['Kitchen', 'GFCI', 'Pool', 'Basement', '240V', 'Garage', 'Lights'] as suggestion}
							<button
								onclick={() => { query = suggestion; doSearch(); }}
								class="px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-xs text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
							>
								{suggestion}
							</button>
						{/each}
					</div>
				</div>
			</div>
		{:else if totalResults === 0}
			<div class="text-center py-12 space-y-2">
				<Icon icon="mdi:magnify-close" width={32} class="text-slate-700 mx-auto" />
				<p class="text-sm text-slate-400">No results for "<span class="text-white">{query}</span>"</p>
				<a href="/chat?q={encodeURIComponent(query)}" class="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-400 text-sm hover:bg-blue-600/20 transition-colors">
					<Icon icon="mdi:chat-processing-outline" width={16} />
					Ask AI instead
				</a>
			</div>
		{:else}
			{#each Object.entries(filteredResults) as [tableName, records]}
				{@const cat = getCategoryInfo(tableName)}
				<div>
					<h2 class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide {cat.color} mb-1.5 px-1">
						<Icon icon={cat.icon} width={13} />
						{cat.label}
					</h2>
					<div class="space-y-1">
						{#each records as record}
							{@const link = getLink(tableName, record)}
							{@const subtext = getSubtext(tableName, record)}
							{@const icon = getResultIcon(tableName, record)}
							{#if link}
								<a href={link} class="flex items-center gap-3 bg-slate-800/60 rounded-lg p-3 border border-slate-700/40 hover:border-slate-500/50 transition-colors">
									<div class="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-700/60 shrink-0">
										<Icon {icon} width={18} class={cat.color} />
									</div>
									<div class="flex-1 min-w-0">
										<p class="text-sm text-white font-medium truncate">{getDisplayName(record)}</p>
										{#if subtext}
											<p class="text-xs text-slate-500 truncate mt-0.5">{subtext}</p>
										{/if}
									</div>
									<Icon icon="mdi:chevron-right" width={16} class="text-slate-600 shrink-0" />
								</a>
							{:else}
								<div class="flex items-center gap-3 bg-slate-800/60 rounded-lg p-3 border border-slate-700/40">
									<div class="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-700/60 shrink-0">
										<Icon {icon} width={18} class={cat.color} />
									</div>
									<div class="flex-1 min-w-0">
										<p class="text-sm text-white font-medium truncate">{getDisplayName(record)}</p>
										{#if subtext}
											<p class="text-xs text-slate-500 truncate mt-0.5">{subtext}</p>
										{/if}
									</div>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
