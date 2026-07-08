<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { slide, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Icon from '@iconify/svelte';
	import {
		startCamera,
		stopCamera,
		toggleTorch,
		computeSlotPositions,
		computeUtilization,
		loadCalibration,
		saveCalibration,
		type GridCalibration,
		type SlotPosition,
		type UtilizationResult
	} from '$lib/services/ar';

	interface V3Record {
		id: number;
		fields: Record<string, unknown>;
	}

	interface Props {
		panel: V3Record;
		circuits: V3Record[];
		loads: V3Record[];
		receptacles: V3Record[];
		onClose: () => void;
	}

	let { panel, circuits, loads, receptacles, onClose }: Props = $props();

	// State
	let videoEl: HTMLVideoElement | undefined = $state();
	let stream: MediaStream | null = $state(null);
	let cameraReady = $state(false);
	let cameraError: string | null = $state(null);
	let aligned = $state(false);
	let selectedCircuit: V3Record | null = $state(null);
	let showLegend = $state(false);
	let torchOn = $state(false);
	let torchSupported = $state(false);

	// Grid calibration — load saved or use defaults
	let calibration: GridCalibration = $state(
		loadCalibration(panel.id) || { topPct: 8, bottomPct: 92, leftPct: 10, rightPct: 90 }
	);

	// Derived data
	const panelCircuits = $derived(
		circuits
			.filter((c) => {
				const panelLink = c.fields.Panel as { id: number } | undefined;
				return panelLink && panelLink.id === panel.id;
			})
			.sort((a, b) => ((a.fields.Number as number) || 99) - ((b.fields.Number as number) || 99))
	);

	const capacity = $derived((panel.fields.Capacity as number) || 24);

	// Build receptacle/load maps for utilization
	const recsByCircuitId = $derived.by(() => {
		const map = new Map<number, V3Record[]>();
		for (const r of receptacles) {
			const circuitLink = r.fields.Circuit as { id: number } | undefined;
			const circuitId = circuitLink?.id ?? (r.fields.Circuit_id as number | undefined);
			if (circuitId) {
				const arr = map.get(circuitId) || [];
				arr.push(r);
				map.set(circuitId, arr);
			}
		}
		return map;
	});

	const loadsByCircuitId = $derived.by(() => {
		const map = new Map<number, V3Record[]>();
		const loadByName = new Map(loads.map((l) => [(l.fields.Name as string) || '', l]));
		for (const rec of receptacles) {
			const circuitLink = rec.fields.Circuit as { id: number } | undefined;
			const circuitId = circuitLink?.id ?? (rec.fields.Circuit_id as number | undefined);
			if (!circuitId) continue;
			const loadNameField = rec.fields['Load Name(s)'];
			if (!loadNameField) continue;
			const loadNames: string[] = typeof loadNameField === 'string'
				? loadNameField.split(',').map(s => s.trim()).filter(Boolean)
				: Array.isArray(loadNameField) ? loadNameField.filter(Boolean) : [];
			for (const name of loadNames) {
				const loadRecord = loadByName.get(name);
				if (loadRecord) {
					const arr = map.get(circuitId) || [];
					if (!arr.some(l => l.id === loadRecord.id)) arr.push(loadRecord);
					map.set(circuitId, arr);
				}
			}
		}
		return map;
	});

	// Utilization — delegates to service
	function getUtilization(circuit: V3Record): UtilizationResult {
		return computeUtilization(circuit, loadsByCircuitId);
	}

	function getStatusColor(status: string): string {
		switch (status) {
			case 'normal': return 'bg-emerald-500';
			case 'high': return 'bg-amber-500';
			case 'overloaded': return 'bg-red-500';
			default: return 'bg-slate-500';
		}
	}

	function getStatusBorder(status: string): string {
		switch (status) {
			case 'normal': return 'border-emerald-500/40';
			case 'high': return 'border-amber-500/40';
			case 'overloaded': return 'border-red-500/40';
			default: return 'border-slate-500/30';
		}
	}

	// Slot positions — computed by service
	const slotPositions = $derived(computeSlotPositions(panelCircuits, capacity, calibration));

	// Camera management — delegates to service
	async function initCamera() {
		if (!videoEl) return;
		const result = await startCamera(videoEl);
		stream = result.stream;
		cameraReady = result.ready;
		cameraError = result.error;

		// Check torch support for dark panels
		if (result.stream) {
			torchSupported = await toggleTorch(result.stream, false).then(() => true).catch(() => false);
		}
	}

	async function handleToggleTorch() {
		torchOn = !torchOn;
		await toggleTorch(stream, torchOn);
	}

	function handleLockAlignment() {
		aligned = true;
		saveCalibration(panel.id, calibration);
	}

	function handleRecalibrate() {
		aligned = false;
		selectedCircuit = null;
	}

	function handleBreakerTap(circuit: V3Record) {
		if (!aligned) return;
		selectedCircuit = selectedCircuit?.id === circuit.id ? null : circuit;
	}

	function getCircuitShortName(circuit: V3Record): string {
		const name = (circuit.fields.Name as string) || '';
		// Truncate for overlay display
		return name.length > 12 ? name.slice(0, 11) + '…' : name;
	}

	function getCircuitDeviceCount(circuit: V3Record): { loads: number; recs: number } {
		return {
			loads: (loadsByCircuitId.get(circuit.id) || []).length,
			recs: (recsByCircuitId.get(circuit.id) || []).length
		};
	}

	onMount(() => {
		initCamera();
	});

	onDestroy(() => {
		stopCamera(stream);
	});
</script>

<div class="fixed inset-0 z-50 bg-black flex flex-col" transition:fade={{ duration: 200 }}>
	<!-- Camera feed -->
	<video
		bind:this={videoEl}
		class="absolute inset-0 w-full h-full object-cover"
		autoplay
		playsinline
		muted
	></video>

	<!-- Overlay layer -->
	{#if cameraError}
		<!-- Error state -->
		<div class="absolute inset-0 flex items-center justify-center bg-black/80 p-6">
			<div class="text-center max-w-xs">
				<Icon icon="mdi:camera-off" class="w-12 h-12 text-red-400 mx-auto mb-3" />
				<p class="text-white text-sm mb-4">{cameraError}</p>
				<button
					onclick={onClose}
					class="px-4 py-2 rounded-xl bg-slate-700 text-white text-sm font-medium
						active:scale-[0.96] transition-transform duration-100"
				>
					Go Back
				</button>
			</div>
		</div>
	{:else if !cameraReady}
		<!-- Loading camera -->
		<div class="absolute inset-0 flex items-center justify-center bg-black/60">
			<div class="text-center">
				<Icon icon="mdi:camera" class="w-10 h-10 text-slate-300 mx-auto mb-2 animate-pulse" />
				<p class="text-slate-300 text-sm">Starting camera…</p>
			</div>
		</div>
	{:else if !aligned}
		<!-- Alignment mode -->
		<div class="absolute inset-0">
			<!-- Dim area outside alignment frame -->
			<div class="absolute inset-0 bg-black/40"></div>

			<!-- Alignment frame -->
			<div
				class="absolute border-2 border-dashed border-white/70 rounded-lg"
					style="top: {calibration.topPct}%; left: {calibration.leftPct}%; width: {calibration.rightPct - calibration.leftPct}%; height: {calibration.bottomPct - calibration.topPct}%;"
			>
				<!-- Corner markers -->
				<div class="absolute -top-1 -left-1 w-6 h-6 border-t-2 border-l-2 border-white rounded-tl-sm"></div>
				<div class="absolute -top-1 -right-1 w-6 h-6 border-t-2 border-r-2 border-white rounded-tr-sm"></div>
				<div class="absolute -bottom-1 -left-1 w-6 h-6 border-b-2 border-l-2 border-white rounded-bl-sm"></div>
				<div class="absolute -bottom-1 -right-1 w-6 h-6 border-b-2 border-r-2 border-white rounded-br-sm"></div>

				<!-- Center text -->
				<div class="absolute inset-0 flex items-center justify-center">
					<div class="text-center px-4 py-3 bg-black/60 rounded-xl backdrop-blur-sm">
						<p class="text-white text-sm font-medium mb-1">Align your panel</p>
						<p class="text-slate-300 text-xs">Position the breaker box within this frame</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Bottom controls - alignment mode -->
		<div class="absolute bottom-0 inset-x-0 p-5 pb-8 bg-gradient-to-t from-black/80 to-transparent">
			<div class="flex items-center justify-between">
				<button
					onclick={onClose}
					class="w-11 h-11 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center
						active:scale-[0.96] transition-transform duration-100"
				>
					<Icon icon="mdi:close" class="w-5 h-5 text-white" />
				</button>

				<button
					onclick={handleLockAlignment}
					class="px-5 py-2.5 rounded-full bg-indigo-500 text-white text-sm font-semibold
						shadow-lg shadow-indigo-500/30 active:scale-[0.96] transition-transform duration-100"
				>
					<Icon icon="mdi:lock" class="w-4 h-4 inline mr-1.5" />
					Lock Alignment
				</button>
			</div>
		</div>
	{:else}
		<!-- Active overlay mode -->
		<div class="absolute inset-0">
			<!-- Breaker grid overlay -->
			{#each slotPositions as slot}
				{@const util = getUtilization(slot.circuit)}
				<button
					class="absolute rounded-md border backdrop-blur-[2px] flex flex-col items-start justify-center px-2
						transition-opacity duration-150 {getStatusBorder(util.status)}
						{selectedCircuit?.id === slot.circuit.id ? 'bg-white/25 border-white/60' : 'bg-black/40'}"
					style="top: {slot.top}; left: {slot.left}; width: {slot.width}; height: {slot.height};"
					onclick={() => handleBreakerTap(slot.circuit)}
				>
					<div class="flex items-center gap-1 w-full">
						<span class="text-[10px] font-bold text-white/90 tabular-nums">
							{slot.circuit.fields.Number}
						</span>
						<span class="text-[9px] text-white/70 tabular-nums">
							{slot.circuit.fields.Amps || '?'}A
						</span>
						<div class="ml-auto w-2 h-2 rounded-full {getStatusColor(util.status)} shrink-0"></div>
					</div>
					<p class="text-[9px] text-white/80 leading-tight truncate w-full mt-0.5">
						{getCircuitShortName(slot.circuit)}
					</p>
				</button>
			{/each}
		</div>

		<!-- Legend overlay -->
		{#if showLegend}
			<div
				class="absolute top-16 right-3 bg-black/70 backdrop-blur-sm rounded-xl p-3 min-w-[140px]"
				transition:slide={{ duration: 200, easing: cubicOut }}
			>
				<p class="text-[10px] text-slate-400 font-medium uppercase tracking-wide mb-2">Utilization</p>
				<div class="space-y-1.5">
					<div class="flex items-center gap-2">
						<div class="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
						<span class="text-xs text-white/80">&lt; 60% Normal</span>
					</div>
					<div class="flex items-center gap-2">
						<div class="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
						<span class="text-xs text-white/80">60–80% High</span>
					</div>
					<div class="flex items-center gap-2">
						<div class="w-2.5 h-2.5 rounded-full bg-red-500"></div>
						<span class="text-xs text-white/80">&gt; 80% Overloaded</span>
					</div>
					<div class="flex items-center gap-2">
						<div class="w-2.5 h-2.5 rounded-full bg-slate-500"></div>
						<span class="text-xs text-white/80">Unknown</span>
					</div>
				</div>
			</div>
		{/if}

		<!-- Bottom controls - active mode -->
		<div class="absolute bottom-0 inset-x-0 p-5 pb-8 bg-gradient-to-t from-black/80 to-transparent">
			<div class="flex items-center justify-between">
				<button
					onclick={onClose}
					class="w-11 h-11 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center
						active:scale-[0.96] transition-transform duration-100"
				>
					<Icon icon="mdi:close" class="w-5 h-5 text-white" />
				</button>

				<div class="flex gap-2">
						{#if torchSupported}
							<button
								onclick={handleToggleTorch}
								class="w-11 h-11 rounded-full flex items-center justify-center
									active:scale-[0.96] transition-transform duration-100
									{torchOn ? 'bg-amber-500/30 backdrop-blur-sm' : 'bg-white/10 backdrop-blur-sm'}"
							>
								<Icon icon={torchOn ? 'mdi:flashlight' : 'mdi:flashlight-off'} class="w-5 h-5 text-white" />
							</button>
						{/if}
						<button
							onclick={() => showLegend = !showLegend}
							class="w-11 h-11 rounded-full flex items-center justify-center
								active:scale-[0.96] transition-transform duration-100
								{showLegend ? 'bg-indigo-500/30 backdrop-blur-sm' : 'bg-white/10 backdrop-blur-sm'}"
						>
							<Icon icon="mdi:information-outline" class="w-5 h-5 text-white" />
						</button>
						<button
							onclick={handleRecalibrate}
							class="w-11 h-11 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center
								active:scale-[0.96] transition-transform duration-100"
						>
							<Icon icon="mdi:tune" class="w-5 h-5 text-white" />
						</button>
					</div>
			</div>
		</div>

		<!-- Circuit detail bottom sheet -->
		{#if selectedCircuit}
			{@const util = getUtilization(selectedCircuit)}
			{@const devices = getCircuitDeviceCount(selectedCircuit)}
			{@const circuitLoads = loadsByCircuitId.get(selectedCircuit.id) || []}
			{@const circuitRecs = recsByCircuitId.get(selectedCircuit.id) || []}
			<div
				class="absolute bottom-20 inset-x-3 bg-slate-900/95 backdrop-blur-md rounded-2xl p-4 shadow-2xl border border-slate-700/50"
				transition:slide={{ duration: 250, easing: cubicOut }}
			>
				<!-- Header -->
				<div class="flex items-start justify-between mb-3">
					<div>
						<h3 class="text-white font-semibold text-sm">
							Circuit {selectedCircuit.fields.Number} — {selectedCircuit.fields.Name || 'Unnamed'}
						</h3>
						<div class="flex items-center gap-2 mt-1">
							<span class="text-[11px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-medium tabular-nums">
								{selectedCircuit.fields.Amps || '?'}A
							</span>
							{#if selectedCircuit.fields['GFCI Protected'] || selectedCircuit.fields.GFCI_Protected}
								<span class="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">GFCI</span>
							{/if}
							{#if selectedCircuit.fields['AFCI Protected'] || selectedCircuit.fields.AFCI_Protected}
								<span class="text-[11px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-medium">AFCI</span>
							{/if}
						</div>
					</div>
					<button
						onclick={() => selectedCircuit = null}
						class="w-7 h-7 rounded-full bg-slate-700/80 flex items-center justify-center
							active:scale-[0.96] transition-transform duration-100"
					>
						<Icon icon="mdi:close" class="w-4 h-4 text-slate-400" />
					</button>
				</div>

				<!-- Utilization bar -->
				{#if util.status !== 'unknown'}
					<div class="mb-3">
						<div class="flex items-center justify-between mb-1">
							<span class="text-[11px] text-slate-400">Utilization</span>
							<span class="text-[11px] font-medium tabular-nums {util.status === 'overloaded' ? 'text-red-400' : util.status === 'high' ? 'text-amber-400' : 'text-emerald-400'}">
								{util.percent}%
							</span>
						</div>
						<div class="h-1.5 bg-slate-700 rounded-full overflow-hidden">
							<div
								class="h-full rounded-full transition-all duration-300 {getStatusColor(util.status)}"
								style="width: {Math.min(util.percent, 100)}%"
							></div>
						</div>
					</div>
				{/if}

				<!-- Devices summary -->
				<div class="flex gap-4 text-xs">
					{#if circuitLoads.length > 0}
						<div>
							<span class="text-slate-400">Loads:</span>
							<span class="text-white ml-1">{circuitLoads.length}</span>
							<div class="mt-1 space-y-0.5">
								{#each circuitLoads.slice(0, 3) as load}
									<p class="text-[10px] text-slate-400 truncate max-w-[120px]">
										{load.fields.Name || 'Unknown'}
										{#if load.fields.Wattage}
											<span class="text-slate-500 tabular-nums">({load.fields.Wattage}W)</span>
										{/if}
									</p>
								{/each}
								{#if circuitLoads.length > 3}
									<p class="text-[10px] text-slate-500">+{circuitLoads.length - 3} more</p>
								{/if}
							</div>
						</div>
					{/if}
					{#if circuitRecs.length > 0}
						<div>
							<span class="text-slate-400">Receptacles:</span>
							<span class="text-white ml-1">{circuitRecs.length}</span>
						</div>
					{/if}
				</div>

				<!-- Area -->
				{#if selectedCircuit.fields['Area Name']}
					<div class="mt-2 pt-2 border-t border-slate-700/50">
						<span class="text-[11px] text-slate-400">Area:</span>
						<span class="text-[11px] text-white ml-1">
							{Array.isArray(selectedCircuit.fields['Area Name'])
								? selectedCircuit.fields['Area Name'].join(', ')
								: selectedCircuit.fields['Area Name']}
						</span>
					</div>
				{/if}
			</div>
		{/if}
	{/if}

	<!-- Top bar - panel name -->
	{#if cameraReady}
		<div class="absolute top-0 inset-x-0 pt-12 px-4 pb-3 bg-gradient-to-b from-black/60 to-transparent">
			<div class="flex items-center gap-2">
				<Icon icon="mdi:augmented-reality" class="w-5 h-5 text-indigo-400" />
				<span class="text-white text-sm font-medium">{panel.fields.Name || 'Panel'}</span>
				<span class="text-slate-400 text-xs">· AR Mode</span>
			</div>
		</div>
	{/if}
</div>
