<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import EnergyInsights from '$lib/components/energy/EnergyInsights.svelte';
	import { buildEnergyInsights } from '$lib/services/energy/insights';
	import { geo, type HomeLocation } from '$lib/stores/geolocation.svelte';
	import { dataStore, ensureLoaded } from '$lib/stores/data.svelte';
	import { homeContext, homeFiltered, initHomeContext } from '$lib/stores/home-context.svelte';
	import { chatState, initChat } from '$lib/stores/chat.svelte';
	import type { HistoryPoint, HistoricalSummary } from '$lib/types/energy';

	let loading = $derived(!dataStore.loaded);
	let geoToast: string | null = $state(null);

	const homes = $derived(dataStore.homes);

	const selectedHome = $derived(homes.find((h) => h.id === homeContext.selectedHomeId));

	// Use homeFiltered for all home-scoped data
	const homeAreas = $derived(homeFiltered.areas);
	const homePanels = $derived(homeFiltered.panels);
	const homeCircuits = $derived(homeFiltered.circuits);
	const homeLoads = $derived(homeFiltered.loads);
	const homeReceptacles = $derived(homeFiltered.receptacles);

	const stats = $derived.by(() => ({
		panels: homePanels.length,
		circuits: homeCircuits.length,
		receptacles: homeReceptacles.length,
		loads: homeLoads.length,
		areas: homeAreas.length
	}));

	// Network device count (filtered to home)
	const networkDeviceCount = $derived(
		homeLoads.filter(l => (l.fields['Device Type'] as string) === 'Networking').length
	);

	// Panel slot usage (circuits used / total available spaces)
	const panelSlotInfo = $derived.by(() => {
		if (!homePanels.length) return null;
		let totalSlots = 0;
		let usedSlots = 0;
		for (const panel of homePanels) {
			const slots = Number(panel.fields['Total Spaces'] || panel.fields.Spaces || 0);
			totalSlots += slots;
			for (const circuit of homeCircuits) {
				const circPanel = circuit.fields.Panel as { id: number } | undefined;
				if (circPanel?.id === panel.id) {
					const size = Number(circuit.fields['Breaker Size'] || circuit.fields.Amps || 20);
					usedSlots += size > 30 ? 2 : 1;
				}
			}
		}
		if (totalSlots === 0) return null;
		return { used: usedSlots, total: totalSlots, pct: Math.round((usedSlots / totalSlots) * 100) };
	});

	// Insights — computed from data health (filtered to home)
	const insights = $derived.by(() => {
		const items: { icon: string; color: string; text: string; href: string; count: number }[] = [];

		// Loads without floorplan position
		const unplacedLoads = homeLoads.filter(l => {
			const hasArea = l.fields.Area;
			return hasArea && (l.fields.Floorplan_X == null || l.fields.Floorplan_Y == null);
		});
		if (unplacedLoads.length > 0) {
			items.push({
				icon: 'mdi:map-marker-question',
				color: 'text-amber-400',
				text: `${unplacedLoads.length} device${unplacedLoads.length > 1 ? 's' : ''} not placed on floorplan`,
				href: '/rooms?view=floorplan&edit=true',
				count: unplacedLoads.length
			});
		}

		// Loads without a Device Type
		const untypedLoads = homeLoads.filter(l => !l.fields['Device Type']);
		if (untypedLoads.length > 0) {
			items.push({
				icon: 'mdi:tag-off-outline',
				color: 'text-orange-400',
				text: `${untypedLoads.length} load${untypedLoads.length > 1 ? 's' : ''} missing device type`,
				href: '/search?type=load&filter=untyped',
				count: untypedLoads.length
			});
		}

		// Loads without Area (orphaned) — these are global since they have no home assignment
		const orphanedLoads = dataStore.loads.filter(l => !l.fields.Area);
		if (orphanedLoads.length > 0) {
			items.push({
				icon: 'mdi:home-off-outline',
				color: 'text-red-400',
				text: `${orphanedLoads.length} load${orphanedLoads.length > 1 ? 's' : ''} not assigned to a room`,
				href: '/search?type=load&filter=orphaned',
				count: orphanedLoads.length
			});
		}

		// Circuits with no loads
		const circuitsNoLoads = homeCircuits.filter(c => {
			const loads = c.fields.Loads;
			return !loads || (typeof loads === 'number' && loads === 0) || (Array.isArray(loads) && loads.length === 0);
		});
		if (circuitsNoLoads.length > 0) {
			items.push({
				icon: 'lucide:plug-zap',
				color: 'text-emerald-400',
				text: `${circuitsNoLoads.length} circuit${circuitsNoLoads.length > 1 ? 's' : ''} with no loads assigned`,
				href: '/panels?filter=empty',
				count: circuitsNoLoads.length
			});
		}

		return items.slice(0, 4);
	});

	// Energy state (live from SSE)
	let energyWatts: number | null = $state(null);
	let solarWatts: number | null = $state(null);
	let solarToday: number | null = $state(null);
	let liveCircuits: { watts: number }[] = $state([]);
	let energyConnected = $state(false);
	let energySource: EventSource | null = null;
	let energyTodaySummary: HistoricalSummary | null = $state(null);
	let energyTodayPoints: HistoryPoint[] = $state([]);
	let energySolarHistory: HistoryPoint[] = $state([]);

	// Recent chat queries
	const recentQueries = $derived.by(() => {
		const msgs = chatState.messages;
		const pairs: { question: string; answer: string; timestamp: number }[] = [];
		const seen = new Set<string>();
		for (let i = msgs.length - 1; i >= 0 && pairs.length < 3; i--) {
			if (msgs[i].role === 'user') {
				const q = msgs[i].content.trim().toLowerCase();
				if (seen.has(q)) continue;
				seen.add(q);
				const next = msgs[i + 1];
				const answer = next?.role === 'assistant' && next.contentType !== 'error'
					? next.content.slice(0, 80)
					: '';
				pairs.unshift({ question: msgs[i].content, answer, timestamp: msgs[i].timestamp });
			}
		}
		return pairs.slice(-3);
	});

	function formatTimeAgo(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'Just now';
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
		return `${Math.floor(diff / 86_400_000)}d ago`;
	}

	function formatWatts(w: number): string {
		if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(1)} kW`;
		return `${Math.round(w)} W`;
	}

	const allEnergyInsights = $derived.by(() =>
		buildEnergyInsights({
			todaySummary: energyTodaySummary,
			todayTotalPoints: energyTodayPoints,
			solarHistory: energySolarHistory,
			activeCircuitCount: liveCircuits.filter((circuit) => circuit.watts >= 1).length
		})
	);

	let insightRotationIndex = $state(0);
	const INSIGHTS_VISIBLE = 3;
	const energyInsights = $derived.by(() => {
		const all = allEnergyInsights;
		if (all.length <= INSIGHTS_VISIBLE) return all;
		const start = insightRotationIndex % all.length;
		const rotated = [...all.slice(start), ...all.slice(0, start)];
		return rotated.slice(0, INSIGHTS_VISIBLE);
	});

	onMount(() => {
		initChat();

		const insightTimer = setInterval(() => {
			if (allEnergyInsights.length > INSIGHTS_VISIBLE) {
				insightRotationIndex++;
			}
		}, 8000);

		void (async () => {
			await ensureLoaded();

			initHomeContext();

			const needsGeocode = homes.filter(
				(h) => !h.fields.Latitude && !h.fields.Longitude && (h.fields.Address || h.fields.City)
			);
			if (needsGeocode.length > 0) {
				void Promise.allSettled(
					needsGeocode.map(async (h) => {
						const resp = await fetch('/api/geocode', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								homeId: h.id,
								address: h.fields.Address || '',
								city: h.fields.City || '',
								state: h.fields.State || '',
								zip: h.fields.ZipCode || ''
							})
						});
						if (resp.ok) {
							const { lat, lng } = await resp.json();
							h.fields.Latitude = lat;
							h.fields.Longitude = lng;
						}
					})
				);
			}

			if (geo.state.permission === 'granted' && homes.length > 1) {
				const homeLocations: HomeLocation[] = homes
					.filter((h) => h.fields.Latitude && h.fields.Longitude)
					.map((h) => ({
						id: h.id,
						name: h.fields.Name as string,
						lat: Number(h.fields.Latitude),
						lng: Number(h.fields.Longitude)
					}));
				const detectedId = await geo.detectHome(homeLocations);
				if (detectedId && detectedId !== homeContext.selectedHomeId) {
					homeContext.selectedHomeId = detectedId;
					const name = homes.find((h) => h.id === detectedId)?.fields.Name as string;
					geoToast = `Switched to ${name} based on your location`;
					setTimeout(() => { geoToast = null; }, 4000);
				}
			}

			try {
				energySource = new EventSource('/api/energy/live');
				energySource.addEventListener('power', (e: MessageEvent) => {
					try {
						const data = JSON.parse(e.data);
						energyConnected = true;
						if (data.total != null) energyWatts = data.total;
						if (data.solar?.production != null) solarWatts = data.solar.production;
						if (data.solar?.todayWh != null) solarToday = data.solar.todayWh / 1000;
						if (Array.isArray(data.circuits)) liveCircuits = data.circuits;
					} catch { /* ignore parse errors */ }
				});
				energySource.addEventListener('error', () => { energyConnected = false; });
			} catch { /* Energy SSE not available */ }

			void Promise.all([
				fetch('/api/energy/history?range=24h&window=today'),
				fetch('/api/energy/solar?range=24h')
			]).then(async ([historyRes, solarRes]) => {
				try {
					if (historyRes.ok) {
						const payload = await historyRes.json();
						energyTodaySummary = payload.summary ?? null;
						energyTodayPoints = payload.totalPoints ?? [];
					}
				} catch {
					energyTodaySummary = null;
				}

				try {
					if (solarRes.ok) {
						const payload = await solarRes.json();
						energySolarHistory = payload.history ?? [];
					}
				} catch {
					energySolarHistory = [];
				}
			}).catch(() => {
				energyTodaySummary = null;
				energySolarHistory = [];
			});
		})();

		return () => { energySource?.close(); clearInterval(insightTimer); };
	});
</script>

<div class="max-w-2xl mx-auto space-y-5">
	<!-- Header -->
	<header class="space-y-3">
		<div>
			<h1 class="text-2xl font-bold text-white" style="text-wrap: balance"><span class="text-accent">&Omega;</span>hm</h1>
		</div>

		<!-- Home toggle -->
		{#if loading}
			<!-- Skeleton home pills -->
			<div class="flex items-center gap-2">
				<div class="h-7 w-24 rounded-full bg-slate-700/60 animate-pulse"></div>
				<div class="h-7 w-20 rounded-full bg-slate-700/40 animate-pulse"></div>
			</div>
		{:else if homes.length > 1}
			<div class="flex items-center gap-2">
				<div class="flex gap-2">
					{#each homes as home}
						{@const active = homeContext.selectedHomeId === home.id}
						<button
							onclick={() => { homeContext.selectedHomeId = home.id; }}
							class="inline-flex items-center gap-1 px-3 rounded-full text-xs font-medium leading-none transition-background-color,color active:scale-[0.96] {active ? 'bg-indigo-600 text-white' : 'bg-slate-700/60 text-slate-300 hover:bg-slate-600'}"
							style="height: 28px"
						>
							{#if active && geo.state.nearestHomeId === home.id && geo.state.permission === 'granted'}
								<Icon icon="mdi:crosshairs-gps" width={12} />
							{/if}
							<span style="transform: translateY(-0.5px)">{home.fields.Name}</span>
						</button>
					{/each}
				</div>
			</div>
		{:else if selectedHome}
			<p class="text-sm text-slate-400">{selectedHome.fields.Name}</p>
		{/if}
	</header>

	<!-- Location permission prompt -->
	{#if geo.state.permission === 'prompt' && homes.length > 1}
		<div class="bg-slate-800/80 border border-slate-700/60 rounded-xl p-4 space-y-3">
			<div class="flex items-start gap-3">
				<div class="w-9 h-9 rounded-lg bg-indigo-500/15 flex items-center justify-center shrink-0">
					<Icon icon="mdi:map-marker-radius" width={20} class="text-indigo-400" />
				</div>
				<div>
					<p class="text-sm font-semibold text-white">Auto-select your home?</p>
					<p class="text-xs text-slate-400 mt-0.5">Uses location to pick the right home on launch</p>
				</div>
			</div>
			<div class="flex items-center gap-2 text-xs text-slate-500">
				<Icon icon="mdi:shield-check-outline" width={14} class="text-emerald-500" />
				<span>Location stays on-device · Never sent to any server</span>
			</div>
			<div class="flex gap-2">
				<button
					onclick={async () => {
						const result = await geo.requestPermission();
						if (result === 'granted' && homes.length > 1) {
							const homeLocations: HomeLocation[] = homes
								.filter((h) => h.fields.Latitude && h.fields.Longitude)
								.map((h) => ({ id: h.id, name: h.fields.Name as string, lat: Number(h.fields.Latitude), lng: Number(h.fields.Longitude) }));
							const detectedId = await geo.detectHome(homeLocations);
							if (detectedId && detectedId !== homeContext.selectedHomeId) {
								homeContext.selectedHomeId = detectedId;
								const name = homes.find((h) => h.id === detectedId)?.fields.Name as string;
								geoToast = `Switched to ${name} based on your location`;
								setTimeout(() => { geoToast = null; }, 4000);
							}
						}
					}}
					disabled={geo.state.loading}
					class="flex-1 bg-indigo-600 text-white text-xs font-semibold py-2.5 rounded-lg hover:bg-indigo-500 transition-background-color active:scale-[0.96] disabled:opacity-50"
				>
					{geo.state.loading ? 'Checking…' : 'Allow location'}
				</button>
				<button
					onclick={() => geo.dismiss()}
					class="flex-1 text-slate-400 text-xs py-2.5 rounded-lg border border-slate-700/60 hover:bg-slate-700/40 transition-background-color active:scale-[0.96]"
				>
					Not now
				</button>
			</div>
		</div>
	{/if}

	<!-- Geo toast -->
	{#if geoToast}
		<div class="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2 text-xs text-emerald-300 animate-fade-in">
			<Icon icon="mdi:check-circle" width={16} class="text-emerald-400" />
			<span>{geoToast}</span>
		</div>
	{/if}

	<!-- Search bar -->
	<a
		href="/search"
		class="flex items-center gap-3 bg-slate-800/60 border border-slate-700/60 rounded-xl px-4 py-3 hover:border-slate-500 transition-border-color"
		style="view-transition-name: search-bar"
	>
		<Icon icon="mdi:magnify" width={18} class="text-slate-500" />
		<span class="text-sm text-slate-500 flex-1">Search rooms, circuits, devices…</span>
		<Icon icon="mdi:microphone-outline" width={18} class="text-slate-600" />
	</a>

	<!-- Energy banner (always visible — clickable deep link to /energy) -->
	<a href="/energy" class="block rounded-xl bg-gradient-to-r from-slate-800/80 to-slate-800/40 border border-slate-700/50 p-4 hover:border-emerald-500/30 transition-colors active:scale-[0.98]">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<span class="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
					<Icon icon="mdi:flash" width={20} class="text-emerald-400" />
				</span>
				<div>
					{#if energyWatts != null}
						<p class="text-sm font-medium text-white" style="font-variant-numeric: tabular-nums">
							{formatWatts(energyWatts)} consuming
						</p>
					{:else}
						<p class="text-sm font-medium text-slate-300">Energy</p>
					{/if}
					{#if solarWatts != null && solarWatts > 0}
						<p class="text-xs text-emerald-400" style="font-variant-numeric: tabular-nums">
							{formatWatts(solarWatts)} solar producing
						</p>
					{:else if !energyConnected}
						<p class="text-xs text-slate-500">Waiting for Home Assistant…</p>
					{/if}
				</div>
			</div>
			<div class="text-right">
				{#if solarToday != null}
					<p class="text-lg font-bold text-yellow-300" style="font-variant-numeric: tabular-nums">{solarToday.toFixed(1)}</p>
					<p class="text-[10px] text-slate-400 uppercase">kWh today</p>
				{:else if panelSlotInfo != null}
					<p class="text-lg font-bold text-white" style="font-variant-numeric: tabular-nums">{panelSlotInfo.used}/{panelSlotInfo.total}</p>
					<p class="text-[10px] text-slate-400 uppercase">slots used</p>
				{/if}
			</div>
		</div>
		{#if energyWatts != null && solarWatts != null}
			{@const net = energyWatts - solarWatts}
			<div class="mt-2.5 flex items-center gap-2 text-xs">
				<span class="text-slate-400">Net:</span>
				<span class={net > 0 ? 'text-orange-300' : 'text-emerald-300'} style="font-variant-numeric: tabular-nums">
					{net > 0 ? '+' : ''}{formatWatts(net)}
					{net <= 0 ? '↑ returning to grid' : '↓ from grid'}
				</span>
			</div>
		{/if}
	</a>

	<!-- Stats row (fills width, colored icons) -->
	{#if loading}
		<div class="grid grid-cols-3 gap-2">
			{#each Array(6) as _}
				<div class="bg-slate-800/40 rounded-lg px-3 py-2.5 flex items-center gap-2.5">
					<div class="w-8 h-8 rounded-lg bg-slate-700/40 animate-pulse shrink-0"></div>
					<div class="space-y-1">
						<div class="h-5 w-6 rounded bg-slate-700/60 animate-pulse"></div>
						<div class="h-3 w-10 rounded bg-slate-700/40 animate-pulse"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="grid grid-cols-3 gap-2">
			<a href="/panels" class="bg-slate-800/40 rounded-lg px-3 py-2.5 flex items-center gap-2.5 hover:bg-slate-800/60 transition-colors active:scale-[0.96]">
				<span class="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center shrink-0">
					<Icon icon="mdi:view-grid-outline" width={16} class="text-cyan-400" />
				</span>
				<div>
					<p class="text-base font-bold text-white leading-tight" style="font-variant-numeric: tabular-nums">{stats.panels}</p>
					<p class="text-[11px] text-slate-400">Panels</p>
				</div>
			</a>
			<a href="/rooms" class="bg-slate-800/40 rounded-lg px-3 py-2.5 flex items-center gap-2.5 hover:bg-slate-800/60 transition-colors active:scale-[0.96]">
				<span class="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center shrink-0">
					<Icon icon="mdi:floor-plan" width={16} class="text-indigo-400" />
				</span>
				<div>
					<p class="text-base font-bold text-white leading-tight" style="font-variant-numeric: tabular-nums">{stats.areas}</p>
					<p class="text-[11px] text-slate-400">Rooms</p>
				</div>
			</a>
			<a href="/search?type=circuit" class="bg-slate-800/40 rounded-lg px-3 py-2.5 flex items-center gap-2.5 hover:bg-slate-800/60 transition-colors active:scale-[0.96]">
				<span class="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
					<Icon icon="lucide:plug-zap" width={16} class="text-emerald-400" />
				</span>
				<div>
					<p class="text-base font-bold text-white leading-tight" style="font-variant-numeric: tabular-nums">{stats.circuits}</p>
					<p class="text-[11px] text-slate-400">Circuits</p>
				</div>
			</a>
			<a href="/search?type=receptacle" class="bg-slate-800/40 rounded-lg px-3 py-2.5 flex items-center gap-2.5 hover:bg-slate-800/60 transition-colors active:scale-[0.96]">
				<span class="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center shrink-0">
					<Icon icon="mdi:power-socket-us" width={16} class="text-indigo-400" />
				</span>
				<div>
					<p class="text-base font-bold text-white leading-tight" style="font-variant-numeric: tabular-nums">{stats.receptacles}</p>
					<p class="text-[11px] text-slate-400">Receptacles</p>
				</div>
			</a>
			<a href="/search?type=load" class="bg-slate-800/40 rounded-lg px-3 py-2.5 flex items-center gap-2.5 hover:bg-slate-800/60 transition-colors active:scale-[0.96]">
				<span class="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
					<Icon icon="mdi:lightbulb-outline" width={16} class="text-amber-400" />
				</span>
				<div>
					<p class="text-base font-bold text-white leading-tight" style="font-variant-numeric: tabular-nums">{stats.loads}</p>
					<p class="text-[11px] text-slate-400">Loads</p>
				</div>
			</a>
			<a href="/rooms?layer=network" class="bg-slate-800/40 rounded-lg px-3 py-2.5 flex items-center gap-2.5 hover:bg-slate-800/60 transition-colors active:scale-[0.96]">
				<span class="w-8 h-8 rounded-lg bg-fuchsia-500/15 flex items-center justify-center shrink-0">
					<Icon icon="mdi:wifi" width={16} class="text-fuchsia-400" />
				</span>
				<div>
					<p class="text-base font-bold text-white leading-tight" style="font-variant-numeric: tabular-nums">{networkDeviceCount}</p>
					<p class="text-[11px] text-slate-400">Network</p>
				</div>
			</a>
		</div>
	{/if}

	<!-- Insights & Actions -->
	{#if !loading && insights.length > 0}
	<section class="space-y-2.5">
		<h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Insights</h2>
		<div class="rounded-xl bg-slate-800/30 border border-slate-700/30 divide-y divide-slate-700/30">
			{#each insights as insight}
				<a href={insight.href} class="flex items-center gap-3 px-4 py-3 hover:bg-slate-700/20 transition-colors first:rounded-t-xl last:rounded-b-xl">
					<Icon icon={insight.icon} width={18} class={insight.color} />
					<span class="text-sm text-slate-300 flex-1">{insight.text}</span>
					<Icon icon="mdi:chevron-right" width={16} class="text-slate-600" />
				</a>
			{/each}
		</div>
	</section>
	{/if}

	<!-- Recent AI queries -->
	{#if !loading && recentQueries.length > 0}
	<section class="space-y-2.5">
		<h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Recent queries</h2>
		<a href="/chat" class="block bg-slate-800/30 rounded-xl border border-slate-700/30 divide-y divide-slate-700/30 hover:border-slate-600/50 transition-colors">
			{#each recentQueries as query}
				<div class="flex items-center gap-3 px-4 py-3">
					<span class="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
						<Icon icon="mdi:chat-outline" width={16} class="text-indigo-400" />
					</span>
					<div class="min-w-0 flex-1">
						<p class="text-sm text-white truncate">"{query.question}"</p>
						<p class="text-xs text-slate-500 truncate">{formatTimeAgo(query.timestamp)}{query.answer ? ` · ${query.answer}` : ''}</p>
					</div>
				</div>
			{/each}
		</a>
	</section>
	{:else if !loading}
	<section class="space-y-2.5">
		<h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">AI Assistant</h2>
		<a href="/chat" class="flex items-center gap-3 px-4 py-4 bg-slate-800/30 rounded-xl border border-slate-700/30 hover:border-indigo-500/30 transition-colors">
			<span class="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
				<Icon icon="mdi:chat-processing-outline" width={20} class="text-indigo-400" />
			</span>
			<div class="min-w-0 flex-1">
				<p class="text-sm font-medium text-white">Ask about your electrical system</p>
				<p class="text-xs text-slate-500">Circuits, panels, rooms, loads, and more</p>
			</div>
			<Icon icon="mdi:chevron-right" width={18} class="text-slate-500" />
		</a>
	</section>
	{/if}

	{#if energyInsights.length > 0}
	<section class="space-y-2.5">
		<div class="flex items-center justify-between gap-3 px-1">
			<div>
				<h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Energy Insights</h2>
				<p class="mt-1 text-xs text-slate-500">Today&apos;s biggest energy takeaways</p>
			</div>
			<a href="/energy" class="inline-flex min-h-[40px] items-center gap-1 rounded-full bg-slate-800/50 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700/60 hover:text-white active:scale-[0.96]">
				View all
				<Icon icon="mdi:chevron-right" width={14} />
			</a>
		</div>
		<EnergyInsights insights={energyInsights} compact />
	</section>
	{/if}
</div>
