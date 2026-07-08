<script lang="ts">
	import Icon from '@iconify/svelte';
	import CircuitRanking from '$lib/components/energy/CircuitRanking.svelte';
	import EnergyFlowDiagram from '$lib/components/energy/EnergyFlowDiagram.svelte';
	import EnergyInsights from '$lib/components/energy/EnergyInsights.svelte';
	import TimeRangeSelector from '$lib/components/energy/TimeRangeSelector.svelte';
	import { buildEnergyInsights } from '$lib/services/energy/insights';
	import { homeContext } from '$lib/stores/home-context.svelte';
	import type {
		TimeRange,
		LiveSSEData,
		CircuitReading,
		SolarReading,
		CostEstimate,
		CapacityAlert,
		HistoryResponse,
		SolarResponse,
		HistoricalSummary,
		CircuitHistory,
		HistoryPoint
	} from '$lib/types/energy';
	import { onMount } from 'svelte';

	let { data } = $props();

	// Build homeId query param string
	function homeParam(prefix: '?' | '&' = '?'): string {
		return homeContext.selectedHomeId ? `${prefix}homeId=${homeContext.selectedHomeId}` : '';
	}

	type LiveStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'historical';

	let selectedRange: TimeRange = $state('live');
	let totalWatts = $state(0);
	let circuits: CircuitReading[] = $state([]);
	let historyCircuits: CircuitHistory[] = $state([]);
	let solar: SolarReading | null = $state(null);
	let cost: CostEstimate | null = $state(null);
	let alerts: CapacityAlert[] = $state([]);
	let connected = $state(false);
	let lastUpdate = $state('');
	let lastUpdateMs = $state(0);
	let eventSource: EventSource | null = null;
	let liveStatus: LiveStatus = $state('idle');
	let isRangeLoading = $state(false);
	let partialNote: string | null = $state(null);
	let solarUnavailable = $state(false);
	let historySummary: HistoricalSummary | null = $state(null);
	let todaySummary: HistoricalSummary | null = $state(null);
	let solarTodayKwh: number | null = $state(null);
	let todayTotalPoints: HistoryPoint[] = $state([]);
	let solarHistory: HistoryPoint[] = $state([]);
	let clockMs = $state(Date.now());
	let showFlow = $state(true);

	// Client-side status (fetched without blocking render)
	let haConnected: boolean | null = $state(null);
	let mappingCount: number | null = $state(null);
	let statusLoading = $state(true);

	let manualSseClose = false;
	let hasSeenLiveData = false;

	const historicalView = $derived(selectedRange !== 'live');
	const staleSeconds = $derived(lastUpdateMs ? Math.max(0, Math.floor((clockMs - lastUpdateMs) / 1000)) : 0);
	const isStale = $derived(selectedRange === 'live' && lastUpdateMs > 0 && clockMs - lastUpdateMs > 30_000);

	function prettyRange(range: TimeRange): string {
		switch (range) {
			case 'live':
				return 'Energy Now';
			case '1h':
				return 'Last Hour';
			case '24h':
				return 'Last 24 Hours';
			case '7d':
				return 'Last 7 Days';
			case '30d':
				return 'Last 30 Days';
		}
	}

	function formatKw(watts: number | null | undefined): string {
		const value = watts ?? 0;
		const decimals = value >= 1000 ? 1 : 2;
		return `${(value / 1000).toFixed(decimals)} kW`;
	}

	function formatKwh(kwh: number | null | undefined): string {
		const value = kwh ?? 0;
		return `${value.toFixed(value >= 10 ? 1 : 2)} kWh`;
	}

	function formatCurrency(amount: number | null | undefined): string {
		return amount == null ? '—' : `$${amount.toFixed(2)}`;
	}

	function clampRatio(value: number | null | undefined): number | null {
		if (value == null || Number.isNaN(value)) return null;
		return Math.min(Math.max(value, 0), 1);
	}

	function buildHistoricalCost(summary: HistoricalSummary): CostEstimate {
		const avgKw = summary.durationHours > 0 ? summary.totalConsumedKwh / summary.durationHours : 0;
		return {
			dailyCost: avgKw * 24 * data.utilityRate,
			monthlyCost: avgKw * 24 * 30 * data.utilityRate,
			ratePerKwh: data.utilityRate
		};
	}

	async function checkHAStatus() {
		const [haResp, mappingResp] = await Promise.all([
			fetch(`/api/settings/ha${homeParam()}`).catch(() => null),
			fetch('/api/energy/mapping').catch(() => null)
		]);

		try {
			if (haResp?.ok) {
				const config = await haResp.json();
				haConnected = Boolean(config.enabled && config.url);
			} else {
				haConnected = false;
			}
		} catch {
			haConnected = false;
		}

		try {
			if (mappingResp?.ok) {
				const mappings = await mappingResp.json();
				mappingCount = Array.isArray(mappings) ? mappings.length : (mappings.mappings?.length ?? 0);
			} else {
				mappingCount = 0;
			}
		} catch {
			mappingCount = 0;
		}

		if (haConnected && mappingCount && mappingCount > 0) {
			void refreshTodayTotals();
			void fetchSolarSnapshot('live');
			connectLive();
		}

		statusLoading = false;
	}

	async function fetchSolarSnapshot(range: TimeRange) {
		try {
			const apiRange = range === 'live' ? '24h' : range;
			const res = await fetch(`/api/energy/solar?range=${apiRange}${homeParam('&')}`);

			if (!res.ok) {
				solarUnavailable = true;
				if (selectedRange !== 'live') {
					partialNote = 'Solar data is unavailable for this period — showing consumption-only history.';
				}
				return;
			}

			const payload: SolarResponse = await res.json();
			solar = payload.current;
			solarTodayKwh = payload.summary.todayKwh;
			if (range === 'live') {
				solarHistory = payload.history ?? [];
			}
			solarUnavailable = false;
		} catch {
			solarUnavailable = true;
		}
	}

	async function refreshTodayTotals() {
		try {
			const [historyRes, solarRes] = await Promise.all([
				fetch(`/api/energy/history?range=24h&window=today${homeParam('&')}`),
				fetch(`/api/energy/solar?range=24h${homeParam('&')}`)
			]);

			if (historyRes.ok) {
				const historyPayload: HistoryResponse = await historyRes.json();
				todaySummary = historyPayload.summary;
				todayTotalPoints = historyPayload.totalPoints ?? [];
			}

			if (solarRes.ok) {
				const solarPayload: SolarResponse = await solarRes.json();
				solarTodayKwh = solarPayload.summary.todayKwh;
				solarHistory = solarPayload.history ?? [];
				if (!solar) {
					solar = solarPayload.current;
				}
				solarUnavailable = false;
			}
		} catch {
			// Keep last known totals if refresh fails.
		}
	}

	function disconnectLive() {
		manualSseClose = true;
		eventSource?.close();
		eventSource = null;
	}

	function applyLivePayload(payload: LiveSSEData) {
		totalWatts = payload.total;
		circuits = payload.circuits;
		solar = payload.solar;
		cost = payload.cost;
		alerts = payload.alerts;
		lastUpdateMs = Date.parse(payload.timestamp) || Date.now();
		lastUpdate = new Date(lastUpdateMs).toLocaleTimeString();
		connected = true;
		liveStatus = 'live';
		hasSeenLiveData = true;
		historySummary = null;
		historyCircuits = [];
		solarUnavailable = payload.solar === null;
		partialNote = payload.solar
			? null
			: 'Solar data is temporarily unavailable — showing the live home load only.';
	}

	function connectLive() {
		if (!haConnected || !mappingCount || mappingCount <= 0) return;

		disconnectLive();
		manualSseClose = false;
		connected = false;
		liveStatus = hasSeenLiveData ? 'reconnecting' : 'connecting';
		eventSource = new EventSource(`/api/energy/live${homeParam()}`);

		eventSource.addEventListener('power', (event) => {
			if (selectedRange !== 'live') return;
			const payload: LiveSSEData = JSON.parse((event as MessageEvent<string>).data);
			applyLivePayload(payload);
		});

		eventSource.addEventListener('error', () => {
			if (manualSseClose || selectedRange !== 'live') return;
			connected = false;
			liveStatus = hasSeenLiveData ? 'reconnecting' : 'idle';
		});

		eventSource.onerror = () => {
			if (manualSseClose || selectedRange !== 'live') return;
			connected = false;
			liveStatus = hasSeenLiveData ? 'reconnecting' : 'idle';
		};
	}

	async function loadHistoricalRange(range: Exclude<TimeRange, 'live'>) {
		isRangeLoading = true;
		disconnectLive();
		connected = false;
		liveStatus = 'historical';
		alerts = [];

		try {
			const [historyRes, solarRes] = await Promise.all([
				fetch(`/api/energy/history?range=${range}${homeParam('&')}`),
				fetch(`/api/energy/solar?range=${range}${homeParam('&')}`)
			]);

			if (!historyRes.ok) {
				throw new Error('Failed to load energy history');
			}

			const historyPayload: HistoryResponse = await historyRes.json();
			historyCircuits = historyPayload.circuits;
			historySummary = historyPayload.summary;
			totalWatts = historyPayload.summary.avgConsumedWatts;
			cost = buildHistoricalCost(historyPayload.summary);
			lastUpdateMs = Date.parse(historyPayload.summary.endTime) || Date.now();
			lastUpdate = new Date(lastUpdateMs).toLocaleTimeString();
			partialNote = historyPayload.summary.partial.solarUnavailable
				? 'Solar history is unavailable for this range.'
				: historyPayload.summary.partial.gridUnavailable
					? 'Grid import/export totals are partial for this range.'
					: null;

			if (solarRes.ok) {
				const solarPayload: SolarResponse = await solarRes.json();
				solar = solarPayload.current;
				solarTodayKwh = solarPayload.summary.todayKwh;
				solarUnavailable = false;
			} else {
				solarUnavailable = true;
			}
		} catch {
			historyCircuits = [];
			historySummary = null;
			partialNote = 'Historical energy data is unavailable right now.';
		} finally {
			isRangeLoading = false;
		}
	}

	function onRangeChange(range: TimeRange) {
		selectedRange = range;

		if (range === 'live') {
			historyCircuits = [];
			historySummary = null;
			void refreshTodayTotals();
			void fetchSolarSnapshot('live');
			connectLive();
			return;
		}

		void loadHistoricalRange(range);
	}

	const headerStatus = $derived.by(() => {
		if (selectedRange !== 'live') {
			return {
				label: prettyRange(selectedRange),
				dot: 'bg-fg-faint',
				className: 'bg-surface-active text-fg-secondary'
			};
		}

		if (liveStatus === 'live') {
			return {
				label: 'Live',
				dot: 'bg-emerald-400 animate-pulse',
				className: 'bg-emerald-500/10 text-emerald-200'
			};
		}

		if (liveStatus === 'reconnecting') {
			return {
				label: 'Reconnecting…',
				dot: 'bg-amber-400 animate-pulse',
				className: 'bg-amber-500/10 text-amber-200'
			};
		}

		if (liveStatus === 'connecting') {
			return {
				label: 'Connecting…',
				dot: 'bg-indigo-400 animate-pulse',
				className: 'bg-indigo-500/10 text-indigo-200'
			};
		}

		return {
			label: 'Offline',
			dot: 'bg-red-400',
			className: 'bg-red-500/10 text-red-200'
		};
	});

	const summaryMetrics = $derived.by(() => {
		const solarWatts =
			selectedRange === 'live'
				? (solar?.production ?? 0)
				: (historySummary?.avgProducedWatts ?? 0);
		const consumptionWatts =
			selectedRange === 'live'
				? totalWatts
				: (historySummary?.avgConsumedWatts ?? totalWatts);
		const dailyCost =
			selectedRange === 'live'
				? (cost?.dailyCost ?? null)
				: (historySummary && historySummary.durationHours > 0
					? (historySummary.totalConsumedKwh / historySummary.durationHours) * 24 * data.utilityRate
					: null);

		let selfSufficiencyRatio: number | null = null;
		if (selectedRange === 'live') {
			if (solar && consumptionWatts > 0) {
				const importWatts = solar.gridImportW > 0
					? solar.gridImportW
					: Math.max(consumptionWatts - solar.production, 0);
				selfSufficiencyRatio = clampRatio(1 - (importWatts / consumptionWatts));
			}
		} else {
			selfSufficiencyRatio = clampRatio(historySummary?.selfSufficiency);
		}

		let gridLabel = 'Grid state unavailable';
		let gridValue = '—';
		let gridTone = 'text-fg-secondary';
		let gridBg = 'bg-surface-active';
		let gridIcon = 'mdi:transmission-tower-off';

		if (selectedRange === 'live' && solar) {
			if (solar.gridExportW > 50 || solar.netWatts < -50) {
				const exportWatts = solar.gridExportW > 0 ? solar.gridExportW : Math.abs(solar.netWatts);
				gridLabel = 'Exporting';
				gridValue = formatKw(exportWatts);
				gridTone = 'text-emerald-400';
				gridBg = 'bg-emerald-500/15';
				gridIcon = 'mdi:transmission-tower-export';
			} else if (solar.gridImportW > 50 || solar.netWatts > 50) {
				const importWatts = solar.gridImportW > 0 ? solar.gridImportW : solar.netWatts;
				gridLabel = 'Importing';
				gridValue = formatKw(importWatts);
				gridTone = 'text-red-400';
				gridBg = 'bg-red-500/15';
				gridIcon = 'mdi:transmission-tower-import';
			} else {
				gridLabel = 'Balanced';
				gridValue = '0.00 kW';
				gridTone = 'text-emerald-400';
				gridBg = 'bg-emerald-500/15';
				gridIcon = 'mdi:home-lightning-bolt';
			}
		} else if (historySummary) {
			if ((historySummary.netExportKwh ?? 0) > 0.05) {
				gridLabel = 'Net export';
				gridValue = formatKwh(historySummary.netExportKwh);
				gridTone = 'text-emerald-400';
				gridBg = 'bg-emerald-500/15';
				gridIcon = 'mdi:transmission-tower-export';
			} else if ((historySummary.netImportKwh ?? 0) > 0.05) {
				gridLabel = 'Net import';
				gridValue = formatKwh(historySummary.netImportKwh);
				gridTone = 'text-red-400';
				gridBg = 'bg-red-500/15';
				gridIcon = 'mdi:transmission-tower-import';
			} else {
				gridLabel = 'Balanced';
				gridValue = '0.00 kWh';
				gridTone = 'text-emerald-400';
				gridBg = 'bg-emerald-500/15';
				gridIcon = 'mdi:home-lightning-bolt';
			}
		}

		return {
			solarWatts,
			consumptionWatts,
			dailyCost,
			selfSufficiencyRatio,
			gridLabel,
			gridValue,
			gridTone,
			gridBg,
			gridIcon
		};
	});

	const totalsPills = $derived.by(() => {
		const producedKwh = solarTodayKwh ?? todaySummary?.totalProducedKwh ?? null;
		const consumedKwh = todaySummary?.totalConsumedKwh ?? null;
		const netImport = todaySummary?.netImportKwh ?? null;
		const netExport = todaySummary?.netExportKwh ?? null;

		let netLabel = 'Net unavailable';
		let netValue = '—';
		let netTone = 'text-fg-secondary';
		let netBg = 'bg-surface-active';
		let netIcon = 'mdi:transmission-tower-off';

		if ((netExport ?? 0) > 0.05) {
			netLabel = 'Exported';
			netValue = formatKwh(netExport);
			netTone = 'text-emerald-400';
			netBg = 'bg-emerald-500/15';
			netIcon = 'mdi:transmission-tower-export';
		} else if ((netImport ?? 0) > 0.05) {
			netLabel = 'Imported';
			netValue = formatKwh(netImport);
			netTone = 'text-red-400';
			netBg = 'bg-red-500/15';
			netIcon = 'mdi:transmission-tower-import';
		}

		return [
			{
				label: 'Produced',
				value: producedKwh == null ? '—' : formatKwh(producedKwh),
				icon: 'mdi:solar-power',
				className: 'bg-amber-500/15 text-amber-300'
			},
			{
				label: 'Consumed',
				value: consumedKwh == null ? '—' : formatKwh(consumedKwh),
				icon: 'mdi:home-lightning-bolt',
				className: 'bg-indigo-500/15 text-indigo-300'
			},
			{
				label: netLabel,
				value: netValue,
				icon: netIcon,
				className: `${netBg} ${netTone}`
			}
		];
	});

	const insights = $derived.by(() =>
		buildEnergyInsights({
			todaySummary,
			todayTotalPoints,
			solarHistory,
			activeCircuitCount: circuits.filter((circuit) => circuit.watts >= 1).length
		})
	);

	onMount(() => {
		void checkHAStatus();
		const clock = setInterval(() => {
			clockMs = Date.now();
		}, 1000);

		return () => {
			clearInterval(clock);
			disconnectLive();
		};
	});
</script>

<div class="space-y-4">
	<header class="px-1">
		<div class="mb-4">
			<div class="flex items-center gap-2.5">
				<Icon icon="mdi:lightning-bolt" width={22} class="text-[#22D3EE]" />
				<h1 class="text-xl font-bold text-fg">Energy Monitor</h1>
				<div class={`ml-auto inline-flex items-center gap-[6px] rounded-pill px-2.5 py-[5px] text-[11px] font-bold shadow-card ${headerStatus.className}`}>
					<span class={`h-2 w-2 rounded-full ${headerStatus.dot}`}></span>
					{headerStatus.label}
				</div>
			</div>
			<p class="mt-1 text-sm text-fg-muted">Emporia Vue · Home energy overview</p>
		</div>

		<TimeRangeSelector bind:selected={selectedRange} onchange={onRangeChange} />
	</header>

	{#if statusLoading}
		<div class="space-y-4 animate-pulse">
			<div class="card h-56"></div>
			<div class="grid gap-3 sm:grid-cols-3">
				<div class="card h-24"></div>
				<div class="card h-24"></div>
				<div class="card h-24"></div>
			</div>
			<div class="card h-64"></div>
		</div>
	{:else if !haConnected}
		<div class="card border-amber-500/20 bg-amber-500/10 p-4 text-center">
			<Icon icon="mdi:home-assistant" width={32} class="mx-auto mb-2 text-amber-400" />
			<p class="text-sm font-medium text-amber-200">Home Assistant not connected</p>
			<p class="mt-1 text-xs text-amber-300/70">Go to Settings → Home Assistant to connect</p>
			<a href="/settings" class="mt-3 inline-block rounded-md bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-200 transition-transform active:scale-[0.96]">
				Configure →
			</a>
		</div>
	{:else if mappingCount === 0}
		<div class="card border-indigo-500/20 bg-indigo-500/10 p-4 text-center">
			<Icon icon="mdi:link-variant" width={32} class="mx-auto mb-2 text-indigo-400" />
			<p class="text-sm font-medium text-indigo-200">No circuits mapped</p>
			<p class="mt-1 text-xs text-indigo-300/70">Map your Emporia Vue entities to your electrical circuits</p>
			<a href="/settings/energy" class="mt-3 inline-block rounded-md bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-200 transition-transform active:scale-[0.96]">
				Map Circuits →
			</a>
		</div>
	{:else}
		<div class="card overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-5">
			<div class="flex items-start justify-between gap-4">
				<div>
					<p class="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-muted">{prettyRange(selectedRange)}</p>
					<h2 class="mt-1 text-2xl font-semibold text-fg" style="text-wrap: balance;">
						{selectedRange === 'live' ? 'Unified Energy Summary' : 'Historical Energy Summary'}
					</h2>
				</div>
				<div class="text-right">
					<p class="text-[11px] uppercase tracking-[0.08em] text-fg-faint">Utility rate</p>
					<p class="mt-1 text-sm font-semibold text-fg">${data.utilityRate.toFixed(3)}/kWh</p>
				</div>
			</div>

			<div class="mt-5 grid gap-3 sm:grid-cols-2">
				<div class="rounded-card bg-amber-500/15 p-4 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.12)]">
					<div class="flex items-center gap-2 text-amber-300">
						<Icon icon="mdi:solar-power" width={18} />
						<p class="text-[11px] font-bold uppercase tracking-[0.08em]">Solar production</p>
					</div>
					<p class="mt-3 text-3xl font-bold text-amber-200" style="font-variant-numeric: tabular-nums;">
						{formatKw(summaryMetrics.solarWatts)}
					</p>
					<p class="mt-1 text-sm text-amber-100/80">
						{selectedRange === 'live' ? 'Live solar output' : 'Average over selected range'}
					</p>
				</div>

				<div class="rounded-card bg-indigo-500/15 p-4 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.12)]">
					<div class="flex items-center gap-2 text-indigo-300">
						<Icon icon="mdi:home-lightning-bolt" width={18} />
						<p class="text-[11px] font-bold uppercase tracking-[0.08em]">Home consumption</p>
					</div>
					<p class="mt-3 text-3xl font-bold text-indigo-200" style="font-variant-numeric: tabular-nums;">
						{formatKw(summaryMetrics.consumptionWatts)}
					</p>
					<p class="mt-1 text-sm text-indigo-100/80">
						{selectedRange === 'live' ? 'Live home load' : 'Average over selected range'}
					</p>
				</div>
			</div>

			<div class="mt-3 grid gap-3 md:grid-cols-3">
				<div class={`rounded-card p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] ${summaryMetrics.gridBg}`}>
					<div class={`flex items-center gap-2 ${summaryMetrics.gridTone}`}>
						<Icon icon={summaryMetrics.gridIcon} width={18} />
						<p class="text-[11px] font-bold uppercase tracking-[0.08em]">Grid state</p>
					</div>
					<p class={`mt-3 text-2xl font-bold ${summaryMetrics.gridTone}`} style="font-variant-numeric: tabular-nums;">
						{summaryMetrics.gridValue}
					</p>
					<p class="mt-1 text-sm text-fg-secondary">{summaryMetrics.gridLabel}</p>
				</div>

				<div class="rounded-card bg-surface-active p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
					<div class="flex items-center gap-2 text-fg-secondary">
						<Icon icon="mdi:cash-clock" width={18} />
						<p class="text-[11px] font-bold uppercase tracking-[0.08em]">Estimated daily cost</p>
					</div>
					<p class="mt-3 text-2xl font-bold text-fg" style="font-variant-numeric: tabular-nums;">
						{formatCurrency(summaryMetrics.dailyCost)}
					</p>
					<p class="mt-1 text-sm text-fg-secondary">At the current utility rate</p>
				</div>

				<div class="rounded-card bg-surface-active p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
					<div class="flex items-center gap-2 text-fg-secondary">
						<Icon icon="mdi:leaf" width={18} />
						<p class="text-[11px] font-bold uppercase tracking-[0.08em]">Self-sufficiency</p>
					</div>
					<p class="mt-3 text-2xl font-bold text-fg" style="font-variant-numeric: tabular-nums;">
						{summaryMetrics.selfSufficiencyRatio == null ? '—' : `${Math.round(summaryMetrics.selfSufficiencyRatio * 100)}%`}
					</p>
					<p class="mt-1 text-sm text-fg-secondary">
						{selectedRange === 'live' ? 'Load served without the grid' : 'Range average'}
					</p>
				</div>
			</div>

			<div class="mt-4 flex flex-wrap items-center gap-2 text-sm">
				{#if selectedRange === 'live' && liveStatus === 'reconnecting'}
					<div class="inline-flex items-center gap-2 rounded-pill bg-amber-500/10 px-3 py-2 text-amber-200 animate-pulse">
						<Icon icon="mdi:lan-pending" width={16} />
						<span>Reconnecting…</span>
					</div>
				{/if}

				{#if selectedRange === 'live' && isStale}
					<div class="inline-flex items-center gap-2 rounded-pill bg-red-500/10 px-3 py-2 text-red-200">
						<Icon icon="mdi:clock-alert-outline" width={16} />
						<span>Last updated {staleSeconds}s ago</span>
					</div>
				{:else if lastUpdate}
					<div class="inline-flex items-center gap-2 rounded-pill bg-surface-active px-3 py-2 text-fg-secondary">
						<Icon icon="mdi:clock-outline" width={16} />
						<span>Last updated {lastUpdate}</span>
					</div>
				{/if}

				{#if partialNote}
					<div class="inline-flex items-center gap-2 rounded-pill bg-surface-active px-3 py-2 text-fg-secondary">
						<Icon icon="mdi:information-outline" width={16} />
						<span>{partialNote}</span>
					</div>
				{/if}
			</div>
		</div>

		<section class="card overflow-hidden p-0">
			<button
				type="button"
				onclick={() => {
					showFlow = !showFlow;
				}}
				class="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-active/60 active:scale-[0.99]"
			>
				<div>
					<h2 class="text-sm font-semibold text-fg">Energy Flow</h2>
					<p class="text-xs text-fg-muted">Animated live paths between solar, home, and grid</p>
				</div>
				<div class="flex items-center gap-2">
					<span class="rounded-pill bg-surface-active px-3 py-1 text-[11px] font-semibold text-fg-secondary">
						{selectedRange === 'live' ? 'Live' : 'Switch to live'}
					</span>
					<Icon
						icon="mdi:chevron-down"
						width={18}
						class={`text-fg-muted transition-transform ${showFlow ? 'rotate-180' : ''}`}
					/>
				</div>
			</button>

			{#if showFlow}
				<div class="border-t border-slate-800/80 p-4">
					{#if selectedRange === 'live'}
						<EnergyFlowDiagram solar={solar} consumptionWatts={summaryMetrics.consumptionWatts} />
					{:else}
						<div class="rounded-card border border-slate-700/50 bg-slate-950/40 p-4 text-sm text-fg-secondary">
							Live flow animations pause while viewing historical ranges. Switch back to Live to resume real-time paths.
						</div>
					{/if}
				</div>
			{/if}
		</section>

		<section class="space-y-3">
			<div class="px-1">
				<h2 class="text-sm font-semibold text-fg">Today&apos;s Totals</h2>
				<p class="text-xs text-fg-muted">Production, usage, and grid flow since midnight</p>
			</div>
			<div class="grid gap-3 sm:grid-cols-3">
				{#each totalsPills as pill}
					<div class={`rounded-card p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] ${pill.className}`}>
						<div class="flex items-center gap-2">
							<Icon icon={pill.icon} width={18} />
							<p class="text-[11px] font-bold uppercase tracking-[0.08em]">{pill.label}</p>
						</div>
						<p class="mt-3 text-xl font-semibold" style="font-variant-numeric: tabular-nums;">
							{pill.value}
						</p>
					</div>
				{/each}
			</div>
		</section>

		{#if insights.length > 0}
			<section class="space-y-3">
				<div class="px-1">
					<h2 class="text-sm font-semibold text-fg">Insights</h2>
					<p class="text-xs text-fg-muted">Quick takeaways from today&apos;s energy profile</p>
				</div>
				<EnergyInsights {insights} />
			</section>
		{/if}

		{#if isRangeLoading}
			<div class="card flex items-center justify-center gap-3 p-8 text-fg-secondary">
				<Icon icon="mdi:loading" width={22} class="animate-spin" />
				<span>Loading {prettyRange(selectedRange).toLowerCase()} history…</span>
			</div>
		{:else if selectedRange === 'live'}
			<CircuitRanking {circuits} />
		{:else}
			<div class="card p-5">
				<div class="mb-4 flex items-center justify-between gap-3">
					<div>
						<h2 class="text-lg font-semibold text-fg">Top Consumers</h2>
						<p class="text-sm text-fg-muted">{prettyRange(selectedRange)}</p>
					</div>
					<span class="rounded-pill bg-surface-active px-3 py-1 text-[11px] font-semibold text-fg-secondary">
						{historyCircuits.length} circuits
					</span>
				</div>

				{#if historyCircuits.length > 0}
					{@const maxKwh = Math.max(...historyCircuits.map((circuit) => circuit.totalKwh), 0.01)}
					<div class="space-y-2">
						{#each historyCircuits.slice(0, 6) as circuit}
							<div class="rounded-card bg-surface-active p-4">
								<div class="flex items-start justify-between gap-3">
									<div>
										<p class="text-sm font-semibold text-fg">{circuit.circuitName}</p>
										<p class="text-[11px] text-fg-faint">{circuit.panelName}</p>
									</div>
									<div class="text-right">
										<p class="text-base font-semibold text-fg" style="font-variant-numeric: tabular-nums;">
											{formatKwh(circuit.totalKwh)}
										</p>
										<p class="text-[11px] text-fg-muted">{formatKw(circuit.avgWatts)} avg</p>
									</div>
								</div>
								<div class="mt-3 h-2 overflow-hidden rounded-pill bg-slate-950/60">
									<div
										class="h-full rounded-pill bg-gradient-to-r from-indigo-400 to-cyan-400"
										style={`width: ${(circuit.totalKwh / maxKwh) * 100}%`}
									></div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="py-6 text-center text-sm text-fg-muted">
						No historical circuit data for this range.
					</div>
				{/if}
			</div>
		{/if}

		{#if selectedRange === 'live' && alerts.length > 0}
			<div class="card p-5">
				<div class="mb-3 flex items-center gap-2">
					<Icon icon="mdi:alert-circle" width={18} class="text-amber-400" />
					<h2 class="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-muted">Capacity Alerts</h2>
				</div>
				<div class="space-y-2">
					{#each alerts as alert}
						<div class={`flex items-center gap-3 rounded-md px-3 py-2 ${alert.severity === 'critical' ? 'bg-red-500/10' : 'bg-amber-500/10'}`}>
							<Icon
								icon={alert.severity === 'critical' ? 'mdi:alert-octagon' : 'mdi:alert'}
								width={16}
								class={alert.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}
							/>
							<span class={`text-sm ${alert.severity === 'critical' ? 'text-red-200' : 'text-amber-200'}`}>
								{alert.message}
							</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>
