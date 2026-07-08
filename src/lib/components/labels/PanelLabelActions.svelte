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
		downloadAllLabelsAsPng,
		getLabelDimensions,
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
		onpreview,
	}: {
		panel: V3Record;
		circuits: V3Record[];
		onpreview?: (label: RenderedLabel, title: string) => void;
	} = $props();

	const printer = getPrinterService();

	// Attempt auto-reconnect to last paired printer when labels panel opens
	onMount(() => {
		printer.tryAutoReconnect();
	});

	let previewLabel: RenderedLabel | null = $state(null);
	let previewOpen = $state(false);
	let previewTitle = $state('');
	let batchPrinting = $state(false);
	let batchProgress = $state(0);
	let batchTotal = $state(0);
	let batchError: string | null = $state(null);
	let connecting = $state(false);

	const panelName = $derived((panel.fields.Name as string) || 'Panel');

	function showPreview(label: RenderedLabel, title: string) {
		if (onpreview) {
			onpreview(label, title);
		} else {
			previewLabel = label;
			previewTitle = title;
			previewOpen = true;
		}
	}

	function previewPanelDirectory() {
		printPanelDirectoryPdf({
			panelName,
			location: (panel.fields.Location as string) || undefined,
			capacity: (panel.fields.Capacity as number) || undefined,
			serviceSize: (panel.fields['Service Size'] as string) || undefined,
			circuits: circuits.map(c => ({
				number: (c.fields.Number as number) || 0,
				name: (c.fields.Name as string) || '',
				amps: (c.fields.Amps as number) || 0,
				gfci: !!(c.fields['GFCI Protected'] || c.fields.GFCI_Protected),
				afci: !!(c.fields['AFCI Protected'] || c.fields.AFCI_Protected),
				poles: (c.fields.Poles as number) || 1,
			})),
		});
	}

	function previewCircuitLabel(circuit: V3Record) {
		const label = renderCircuitLabel(circuit, panelName, CIRCUIT_LABEL_DETAILED);
		showPreview(label, `Ckt ${circuit.fields.Number} — ${circuit.fields.Name || 'Circuit'}`);
	}

	async function printAllCircuitLabels() {
		// Prompt connection if not connected
		if (!printer.isConnected) {
			try {
				await printer.connect();
			} catch {
				return; // User cancelled or BLE unavailable
			}
		}

		batchPrinting = true;
		batchProgress = 0;
		batchTotal = circuits.length;

		const labels = circuits.map(circuit =>
			renderCircuitLabel(circuit, panelName, CIRCUIT_LABEL_COMPACT)
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

	function downloadAllLabels() {
		const labels = circuits.map(circuit =>
			renderCircuitLabel(circuit, panelName, CIRCUIT_LABEL_COMPACT)
		);
		downloadAllLabelsAsPng(labels, `${panelName.toLowerCase().replace(/\s+/g, '-')}-ckt`);
	}

	async function printAllQrLabels() {
		if (!printer.isConnected) {
			try {
				await printer.connect();
			} catch {
				return;
			}
		}

		batchPrinting = true;
		batchProgress = 0;
		batchTotal = circuits.length;
		batchError = null;

		try {
			const baseUrl = window.location.origin;
			const config = await fetchPrinterConfig();
			const dims = getLabelDimensions(config);

			for (let i = 0; i < circuits.length; i++) {
				const circuit = circuits[i];
				const f = circuit.fields;
				const label = await renderQrLabel({
					url: buildCircuitUrl(baseUrl, panel.id, circuit.id),
					line1: `Ckt ${f.Number} · ${panelName}`,
					line2: (f.Name as string) || 'Circuit',
					line3: f.Amps ? `${f.Amps}A${f['GFCI Protected'] || f.GFCI_Protected ? ' GFCI' : ''}` : undefined,
					widthMm: dims.widthMm,
					heightMm: dims.heightMm,
				});
				await printer.printLabel(label);
				batchProgress = i + 1;
				if (i < circuits.length - 1) {
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
		return { labelWidthMm: 50, tapeWidthMm: 15, labelLengthMm: 'continuous', dpi: 203, density: 4, serviceUuid: '', writeCharUuid: '', chunkSize: 100, chunkDelayMs: 20 } as PrinterConfig;
	}
</script>

<div class="space-y-2">
	<!-- Printer Status -->
	{#if printer.isAvailable}
		<div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50">
			<span class="w-2 h-2 rounded-full {printer.isConnected ? 'bg-emerald-500' : 'bg-slate-500'}"></span>
			{#if printer.isConnected}
				<span class="text-xs text-emerald-300 flex-1">{printer.deviceName || 'Phomemo'} connected</span>
			{:else}
				<span class="text-xs text-slate-400 flex-1">Printer not connected</span>
				<button
					type="button"
					onclick={connectPrinter}
					disabled={connecting}
					class="text-[11px] px-2 py-1 rounded-md bg-blue-600/80 text-white font-medium hover:bg-blue-500 active:scale-[0.96] transition-colors disabled:opacity-50"
				>
					{connecting ? 'Connecting…' : 'Connect'}
				</button>
			{/if}
		</div>
	{/if}

	<!-- Error -->
	{#if batchError}
		<div class="px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-xs text-red-300">
			{batchError}
		</div>
	{/if}

	<!-- Print Panel Directory (letter-size paper) -->
	<button
		onclick={previewPanelDirectory}
		class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800
			hover:bg-slate-700 active:scale-[0.97] transition-transform duration-100"
	>
		<Icon icon="mdi:format-list-numbered" class="w-5 h-5 text-blue-400" />
		<div class="text-left">
			<p class="text-sm font-medium text-white">Print Panel Directory</p>
			<p class="text-xs text-slate-400">Letter-size schedule for panel door</p>
		</div>
	</button>

	<!-- Print All Circuit Labels via BLE -->
	<button
		onclick={printAllCircuitLabels}
		disabled={batchPrinting}
		class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800
			hover:bg-slate-700 active:scale-[0.97] transition-transform duration-100
			disabled:opacity-50"
	>
		<Icon icon="mdi:bluetooth" class="w-5 h-5 text-emerald-400" />
		<div class="text-left flex-1">
			<p class="text-sm font-medium text-white">Print All Circuit Labels</p>
			<p class="text-xs text-slate-400">{circuits.length} stickers via Phomemo</p>
		</div>
		{#if batchPrinting}
			<span class="text-xs text-blue-400 font-mono" style="font-variant-numeric: tabular-nums">{batchProgress}/{batchTotal}</span>
		{/if}
	</button>

	<!-- Print All QR Labels via BLE -->
	<button
		onclick={printAllQrLabels}
		disabled={batchPrinting}
		class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800
			hover:bg-slate-700 active:scale-[0.97] transition-transform duration-100
			disabled:opacity-50"
	>
		<Icon icon="mdi:qrcode" class="w-5 h-5 text-purple-400" />
		<div class="text-left flex-1">
			<p class="text-sm font-medium text-white">Print All QR Labels</p>
			<p class="text-xs text-slate-400">{circuits.length} QR stickers with deep-links</p>
		</div>
		{#if batchPrinting}
			<span class="text-xs text-purple-400 font-mono" style="font-variant-numeric: tabular-nums">{batchProgress}/{batchTotal}</span>
		{/if}
	</button>

	<!-- Batch progress bar -->
	{#if batchPrinting}
		<div class="px-1">
			<div class="h-1.5 rounded-full bg-slate-700 overflow-hidden">
				<div class="h-full bg-blue-500 transition-[width] duration-200" style="width: {batchTotal ? (batchProgress / batchTotal) * 100 : 0}%"></div>
			</div>
		</div>
	{/if}

	<!-- Download PNGs (fallback) -->
	<button
		onclick={downloadAllLabels}
		class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800
			hover:bg-slate-700 active:scale-[0.97] transition-transform duration-100"
	>
		<Icon icon="mdi:download-multiple" class="w-5 h-5 text-slate-400" />
		<div class="text-left">
			<p class="text-sm font-medium text-white">Download All as PNG</p>
			<p class="text-xs text-slate-400">Save label images for manual printing</p>
		</div>
	</button>
</div>

<!-- Label Preview Modal (only when no external handler) -->
{#if !onpreview}
<LabelPreview
	bind:open={previewOpen}
	label={previewLabel}
	title={previewTitle}
	labelWidthMm={40}
/>
{/if}
