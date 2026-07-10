<!--
  PanelLabelActions.svelte — Panel view "Print Labels" action menu.
  Renders panel directory and circuit labels from NocoDB V3Records.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import {
		getPrinterService,
		renderCircuitLabel,
		renderQrLabel,
		buildCircuitUrl,
		printPanelDirectoryPdf,
		getLabelDimensions,
		circuitTemplateFromConfig,
		CIRCUIT_LABEL_COMPACT,
		CIRCUIT_LABEL_DETAILED,
	} from '$lib/services/label-printing';
	import type { RenderedLabel, PrinterConfig } from '$lib/services/label-printing';
	import LabelPreview from './LabelPreview.svelte';

	interface V3Record {
		id: number;
		fields: Record<string, unknown>;
	}

	let {
		panel,
		circuits,
		receptacles = [],
		onpreview,
	}: {
		panel: V3Record;
		circuits: V3Record[];
		receptacles?: V3Record[];
		onpreview?: (label: RenderedLabel, title: string, widthMm?: number, heightMm?: number) => void;
	} = $props();

	const printer = getPrinterService();

	// Attempt auto-reconnect to last paired printer when labels panel opens
	onMount(() => {
		printer.tryAutoReconnect();
	});

	let previewLabel: RenderedLabel | null = $state(null);
	let previewOpen = $state(false);
	let previewTitle = $state('');
	let previewWidthMm = $state(40);
	let previewHeightMm = $state(12);
	let batchPrinting = $state(false);
	let batchProgress = $state(0);
	let batchTotal = $state(0);
	let batchError: string | null = $state(null);
	let connecting = $state(false);
	let catalogWidthMm = $state('');
	let showDetailed = $state(false);
	let selectedCircuitIds: Set<number> = $state(new Set());
	let showCircuitPicker = $state(false);
	let printMode: 'labels' | 'qr' = $state('labels');

	const panelName = $derived((panel.fields.Name as string) || 'Panel');
	const homeName = $derived((panel.fields['Home Name'] as string) || 'Home');
	const selectedCircuits = $derived(
		selectedCircuitIds.size > 0
			? circuits.filter(c => selectedCircuitIds.has(c.id))
			: circuits
	);

	function toggleCircuit(id: number) {
		const next = new Set(selectedCircuitIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedCircuitIds = next;
	}

	function selectAll() { selectedCircuitIds = new Set(); }
	function selectNone() { selectedCircuitIds = new Set(circuits.map(c => c.id)); /* all selected = use selectedCircuits which filters */ }

	function showPreview(label: RenderedLabel, title: string, widthMm?: number, heightMm?: number) {
		if (onpreview) {
			onpreview(label, title, widthMm, heightMm);
		} else {
			previewLabel = label;
			previewTitle = title;
			previewWidthMm = widthMm ?? 40;
			previewHeightMm = heightMm ?? 12;
			previewOpen = true;
		}
	}

	function inferPoles(circuit: V3Record): number {
		const slot = (circuit.fields['Panel Slot'] as string) || '';
		if (slot.includes(',')) return 2;
		const amps = (circuit.fields.Amps as number) || 0;
		if (amps >= 30) return 2;
		return 1;
	}

	function previewPanelDirectory() {
		// Build receptacle info for detailed mode
		const recData: { name: string; area: string; circuitNumber: number }[] = [];
		if (showDetailed && receptacles.length > 0) {
			for (const r of receptacles) {
				const circuitLink = r.fields.Circuit as { id: number } | undefined;
				const circuitId = circuitLink?.id ?? (r.fields.Circuit_id as number | undefined);
				if (!circuitId) continue;
				const circuit = circuits.find(c => c.id === circuitId);
				if (!circuit) continue;
				recData.push({
					name: (r.fields.Name as string) || 'Unnamed',
					area: (r.fields.Room as string) || (r.fields.Area as string) || '',
					circuitNumber: (circuit.fields.Number as number) || 0,
				});
			}
		}

		printPanelDirectoryPdf({
			panelName,
			location: (panel.fields.Location as string) || undefined,
			capacity: (panel.fields.Capacity as number) || undefined,
			serviceSize: (panel.fields['Service Size'] as string) || undefined,
			generatorBacked: Boolean(panel.fields['Generator Power']),
			circuits: circuits.map(c => ({
				number: (c.fields.Number as number) || 0,
				name: (c.fields.Name as string) || '',
				amps: (c.fields.Amps as number) || 0,
				gfci: !!(c.fields['GFCI Protected'] || c.fields.GFCI_Protected),
				afci: !!(c.fields['AFCI Protected'] || c.fields.AFCI_Protected),
				poles: inferPoles(c),
				monitored: Boolean(c.fields['Energy Monitored']),
			})),
			receptacles: recData.length > 0 ? recData : undefined,
			catalogWidthMm: catalogWidthMm ? Number(catalogWidthMm) : undefined,
		});
	}

	async function previewCircuitLabel(circuit: V3Record) {
		const config = await fetchPrinterConfig();
		const format = (config as any).defaultCircuitFormat || 'compact';
		const template = circuitTemplateFromConfig(config, format);
		const label = renderCircuitLabel(circuit, panelName, template);
		const dims = getLabelDimensions(config);
		showPreview(label, `Ckt ${circuit.fields.Number} — ${circuit.fields.Name || 'Circuit'}`, dims.widthMm, dims.heightMm);
	}

	async function printCircuitLabels() {
		if (!printer.isConnected) {
			try {
				await printer.connect();
			} catch {
				return;
			}
		}

		const toPrint = selectedCircuits;
		batchPrinting = true;
		batchProgress = 0;
		batchTotal = toPrint.length;

		const config = await fetchPrinterConfig();
		printer.updateConfig(config);
		const format = (config as any).defaultCircuitFormat || 'compact';
		const template = circuitTemplateFromConfig(config, format);
		const labels = toPrint.map(circuit =>
			renderCircuitLabel(circuit, panelName, template)
		);

		try {
			await printer.printBatch(labels, (current, total) => {
				batchProgress = current;
				batchTotal = total;
			});
		} catch (e) {
			batchError = e instanceof Error ? e.message : 'Print failed';
		}

		batchPrinting = false;
	}

	async function connectPrinter() {
		connecting = true;
		batchError = null;
		try {
			await printer.connect();
		} catch (e) {
			batchError = e instanceof Error ? e.message : 'Connection failed';
		}
		connecting = false;
	}

	async function downloadAllLabels() {
		const config = await fetchPrinterConfig();
		const template = circuitTemplateFromConfig(config, 'compact');
		const toPrint = selectedCircuits;
		const labels = toPrint.map(circuit =>
			renderCircuitLabel(circuit, panelName, template)
		);
		const prefix = `${homeName}-${panelName}`.toLowerCase().replace(/\s+/g, '-');
		// Download each with house-panel-number naming
		labels.forEach((label, i) => {
			const num = (toPrint[i].fields.Number as number) || (i + 1);
			const filename = `${prefix}-${num}.png`;
			const dataUrl = label.canvas.toDataURL('image/png');
			const link = document.createElement('a');
			link.download = filename;
			link.href = dataUrl;
			setTimeout(() => link.click(), i * 200);
		});
	}

	async function printQrLabels() {
		if (!printer.isConnected) {
			try {
				await printer.connect();
			} catch {
				return;
			}
		}

		const toPrint = selectedCircuits;
		batchPrinting = true;
		batchProgress = 0;
		batchTotal = toPrint.length;
		batchError = null;

		try {
			const baseUrl = window.location.origin;
			const config = await fetchPrinterConfig();
			printer.updateConfig(config);
			const dims = getLabelDimensions(config);

			for (let i = 0; i < toPrint.length; i++) {
				const circuit = toPrint[i];
				const f = circuit.fields;
				const label = await renderQrLabel({
					url: buildCircuitUrl(baseUrl, panel.id, circuit.id),
					line1: (f.Name as string) || 'Circuit',
					line2: `${f.Number} · ${f.Amps || '?'}A${f['GFCI Protected'] || f.GFCI_Protected ? ' · GFCI' : ''}`,
					widthMm: dims.widthMm,
					heightMm: dims.heightMm,
				});
				await printer.printLabel(label);
				batchProgress = i + 1;
				if (i < toPrint.length - 1) {
					await new Promise(resolve => setTimeout(resolve, 100));
				}
			}
		} catch (e) {
			batchError = e instanceof Error ? e.message : 'Print failed';
		}

		batchPrinting = false;
	}

	async function fetchPrinterConfig(): Promise<PrinterConfig> {
		try {
			const res = await fetch('/api/settings/printer');
			if (res.ok) return await res.json();
		} catch { /* fall through */ }
		return { labelWidthMm: 40, tapeWidthMm: 12, labelLengthMm: 40, dpi: 203, density: 4, serviceUuid: '', writeCharUuid: '', chunkSize: 128, chunkDelayMs: 20 } as PrinterConfig;
	}
</script>

<div class="space-y-2">
	<!-- Printer Status -->
	{#if printer.isAvailable}
		<div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50">
			<span class="w-2 h-2 rounded-full {printer.isConnected || printer.isPrinting ? 'bg-emerald-500' : 'bg-slate-500'} {printer.isPrinting ? 'animate-pulse' : ''}"></span>
			{#if printer.isPrinting}
				<span class="text-xs text-indigo-300 flex-1">{printer.deviceName || 'Label printer'} printing…</span>
			{:else if printer.isConnected}
				<span class="text-xs text-emerald-300 flex-1">{printer.deviceName || 'Label printer'} connected</span>
			{:else}
				<span class="text-xs text-slate-400 flex-1">Label printer not connected</span>
				<button
					type="button"
					onclick={connectPrinter}
					disabled={connecting}
					class="text-[11px] px-2 py-1 rounded-md bg-indigo-600/80 text-white font-medium hover:bg-indigo-500 active:scale-[0.96] transition-colors disabled:opacity-50"
				>
					{connecting ? 'Connecting…' : 'Connect'}
				</button>
			{/if}
			{#if printer.printerStatus === 'paper-out'}
				<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300">No paper</span>
			{:else if printer.printerStatus === 'cover-open'}
				<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300">Cover open</span>
			{:else if printer.printerStatus === 'overheated'}
				<span class="text-[10px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-300">Overheated</span>
			{:else if printer.printerStatus === 'low-battery'}
				<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300">Low battery</span>
			{/if}
		</div>
	{:else}
		<div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50">
			<Icon icon="mdi:bluetooth-off" class="w-4 h-4 text-slate-500" />
			<span class="text-xs text-slate-400 flex-1">Bluetooth not supported on this browser. Use Chrome/Edge on desktop, or print via system dialog.</span>
		</div>
	{/if}

	<!-- Error -->
	{#if batchError}
		<div class="px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-xs text-red-300">
			{batchError}
		</div>
	{/if}

	<!-- Print Panel Directory (letter-size paper) -->
	<div class="space-y-2">
		<button
			onclick={previewPanelDirectory}
			class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800
				hover:bg-slate-700 active:scale-[0.97] transition-transform duration-100"
		>
			<Icon icon="mdi:format-list-numbered" class="w-5 h-5 text-indigo-400" />
			<div class="text-left">
				<p class="text-sm font-medium text-white">Print Panel Directory</p>
				<p class="text-xs text-slate-400">Letter-size schedule for panel door</p>
			</div>
		</button>
		<!-- Directory options -->
		<div class="flex items-center gap-2 px-3">
			<label class="flex items-center gap-1.5 text-[11px] text-slate-400">
				<input type="checkbox" bind:checked={showDetailed} class="w-3 h-3 rounded border-slate-600 bg-slate-800 text-indigo-500" />
				Detailed (receptacles)
			</label>
			<label class="flex items-center gap-1.5 text-[11px] text-slate-400 ml-auto">
				Width:
				<input
					type="number"
					bind:value={catalogWidthMm}
					placeholder="auto"
					class="w-12 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] text-white text-center"
					min="80"
					max="300"
				/>
				<span class="text-[10px]">mm</span>
			</label>
		</div>
	</div>

	<!-- Circuit Selection -->
	{#if printer.isAvailable}
	<div class="space-y-1.5">
		<button
			type="button"
			onclick={() => { showCircuitPicker = !showCircuitPicker; }}
			class="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/80 border border-slate-700/50 hover:bg-slate-700/80 transition-colors"
		>
			<Icon icon="mdi:checkbox-multiple-marked" class="w-4 h-4 text-slate-400" />
			<span class="text-[11px] text-slate-300 flex-1 text-left">
				{selectedCircuitIds.size === 0 ? `All ${circuits.length} circuits` : `${selectedCircuitIds.size} of ${circuits.length} selected`}
			</span>
			<Icon icon={showCircuitPicker ? 'mdi:chevron-up' : 'mdi:chevron-down'} class="w-4 h-4 text-slate-500" />
		</button>

		{#if showCircuitPicker}
			<div class="max-h-40 overflow-y-auto rounded-lg bg-slate-900/80 border border-slate-700/50 px-2 py-1.5 space-y-0.5">
				<div class="flex gap-2 mb-1 pb-1 border-b border-slate-700/50">
					<button type="button" onclick={selectAll} class="text-[10px] text-indigo-400 hover:text-indigo-300">All</button>
					<button type="button" onclick={() => { selectedCircuitIds = new Set(); }} class="text-[10px] text-indigo-400 hover:text-indigo-300">Clear</button>
				</div>
				{#each circuits as circuit}
					<label class="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-slate-800/50 rounded px-1">
						<input
							type="checkbox"
							checked={selectedCircuitIds.size === 0 || selectedCircuitIds.has(circuit.id)}
							onchange={() => toggleCircuit(circuit.id)}
							class="w-3 h-3 rounded border-slate-600 bg-slate-800 text-indigo-500"
						/>
						<span class="text-[11px] text-slate-300 flex-1">{circuit.fields.Number} · {circuit.fields.Name || 'Unnamed'}</span>
						<span class="text-[10px] text-slate-500">{circuit.fields.Amps}A</span>
					</label>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Print Circuit Labels -->
	<button
		onclick={printCircuitLabels}
		disabled={batchPrinting}
		class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800
			hover:bg-slate-700 active:scale-[0.97] transition-transform duration-100
			disabled:opacity-50"
	>
		<Icon icon="mdi:label-outline" class="w-5 h-5 text-emerald-400" />
		<div class="text-left flex-1">
			<p class="text-sm font-medium text-white">Print Circuit Labels</p>
			<p class="text-xs text-slate-400">{selectedCircuitIds.size === 0 ? circuits.length : selectedCircuitIds.size} labels via label printer</p>
		</div>
		{#if batchPrinting && printMode === 'labels'}
			<span class="text-xs text-indigo-400 font-mono" style="font-variant-numeric: tabular-nums">{batchProgress}/{batchTotal}</span>
		{/if}
	</button>

	<!-- Print QR Labels -->
	<button
		onclick={printQrLabels}
		disabled={batchPrinting}
		class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800
			hover:bg-slate-700 active:scale-[0.97] transition-transform duration-100
			disabled:opacity-50"
	>
		<Icon icon="mdi:qrcode" class="w-5 h-5 text-indigo-400" />
		<div class="text-left flex-1">
			<p class="text-sm font-medium text-white">Print QR Labels</p>
			<p class="text-xs text-slate-400">{selectedCircuitIds.size === 0 ? circuits.length : selectedCircuitIds.size} QR labels with deep-links</p>
		</div>
		{#if batchPrinting && printMode === 'qr'}
			<span class="text-xs text-indigo-400 font-mono" style="font-variant-numeric: tabular-nums">{batchProgress}/{batchTotal}</span>
		{/if}
	</button>

	<!-- Batch progress bar -->
	{#if batchPrinting}
		<div class="px-1">
			<div class="h-1.5 rounded-full bg-slate-700 overflow-hidden">
				<div class="h-full bg-indigo-500 transition-[width] duration-200" style="width: {batchTotal ? (batchProgress / batchTotal) * 100 : 0}%"></div>
			</div>
		</div>
	{/if}
	{/if}

	<!-- Download PNGs (fallback) -->
	<button
		onclick={downloadAllLabels}
		class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800
			hover:bg-slate-700 active:scale-[0.97] transition-transform duration-100"
	>
		<Icon icon="mdi:download-multiple" class="w-5 h-5 text-slate-400" />
		<div class="text-left">
			<p class="text-sm font-medium text-white">Download as PNG</p>
			<p class="text-xs text-slate-400">{selectedCircuitIds.size === 0 ? circuits.length : selectedCircuitIds.size} label images</p>
		</div>
	</button>
</div>

<!-- Label Preview Modal (only when no external handler) -->
{#if !onpreview}
<LabelPreview
	bind:open={previewOpen}
	label={previewLabel}
	title={previewTitle}
	labelWidthMm={previewWidthMm}
	labelHeightMm={previewHeightMm}
/>
{/if}
