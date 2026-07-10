<!--
  LabelPreview.svelte — Modal for previewing and printing a rendered label.
  Uses Svelte 5 runes and the app's existing dark UI style.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { getPrinterService, downloadLabelAsPng, printSingleLabel, type PrinterConfig } from '$lib/services/label-printing';
	import type { RenderedLabel } from '$lib/services/label-printing';

	let {
		label = null,
		open = $bindable(false),
		title = 'Label Preview',
		labelWidthMm = 40,
		labelHeightMm = 12,
	}: {
		label: RenderedLabel | null;
		open: boolean;
		title?: string;
		labelWidthMm?: number;
		labelHeightMm?: number;
	} = $props();

	const printer = getPrinterService();

	let printing = $state(false);
	let progress = $state(0);
	let error: string | null = $state(null);

	const previewSrc = $derived(label?.canvas.toDataURL('image/png') ?? '');

	function close() {
		open = false;
		error = null;
		progress = 0;
	}

	async function connectPrinter() {
		error = null;
		try {
			await printer.connect();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to connect';
		}
	}

	async function printViaBluetooth() {
		if (!label) return;
		printing = true;
		error = null;
		progress = 0;
		try {
			// Fetch server config and sync to printer service before printing
			try {
				const res = await fetch('/api/settings/printer');
				if (res.ok) {
					const config: PrinterConfig = await res.json();
					printer.updateConfig(config);
				}
			} catch { /* use existing config */ }
			await printer.printLabel(label, (sent, total) => {
				progress = Math.round((sent / total) * 100);
			});
			// Check if printer reported an issue during print
			if (printer.printerStatus === 'paper-out') {
				error = 'Printer is out of paper/labels';
			} else if (printer.printerStatus === 'cover-open') {
				error = 'Printer cover is open';
			} else if (printer.printerStatus === 'overheated') {
				error = 'Printer overheated — wait and retry';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Print failed';
		} finally {
			printing = false;
		}
	}

	function printViaPdf() {
		if (!label) return;
		const height = Math.round((label.height / label.width) * labelWidthMm);
		printSingleLabel(label, labelWidthMm, height);
	}

	function downloadPng() {
		if (!label) return;
		downloadLabelAsPng(label, `${title.toLowerCase().replace(/\s+/g, '-')}.png`);
	}
</script>

{#if open && label}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
		onclick={(e) => { if (e.target === e.currentTarget) close(); }}
		onkeydown={(e) => { if (e.key === 'Escape') close(); }}
		role="dialog"
		aria-modal="true"
		aria-label={title}
	>
		<div class="bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
			<!-- Header -->
			<div class="flex items-center justify-between px-5 py-4 border-b border-slate-700">
				<h2 class="text-lg font-semibold text-white">{title}</h2>
				<button
					onclick={close}
					class="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-slate-300 hover:bg-slate-600 transition-colors duration-150"
					aria-label="Close"
				>
					<Icon icon="mdi:close" class="w-4 h-4" />
				</button>
			</div>

			<!-- Preview -->
			<div class="px-5 py-4 flex justify-center bg-slate-900/50">
				<div class="border border-slate-600 rounded-lg p-2 bg-white overflow-auto max-h-80">
					<img
						src={previewSrc}
						alt="Label preview"
						class="max-w-full h-auto"
						style="image-rendering: pixelated; max-height: 280px;"
					/>
				</div>
			</div>

			<!-- Dimensions info -->
			<div class="px-5 py-2 text-xs text-slate-400 text-center font-variant-numeric:tabular-nums">
					{label.width} × {label.height}px • {labelWidthMm} × {labelHeightMm}mm
			</div>

			<!-- Error -->
			{#if error}
				<div class="mx-5 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
					{error}
				</div>
			{/if}

			<!-- Progress bar -->
			{#if printing}
				<div class="mx-5 mt-2">
					<div class="h-2 rounded-full bg-slate-700 overflow-hidden">
						<div class="h-full bg-indigo-500 transition-[width] duration-200" style="width: {progress}%"></div>
					</div>
					<p class="text-xs text-slate-400 mt-1 text-center">
						{#if progress >= 100}
							Waiting for printer…
						{:else}
							Sending… {progress}%
						{/if}
					</p>
				</div>
			{/if}

			<!-- Actions -->
			<div class="px-5 py-4 flex flex-col gap-2">
				{#if printer.isAvailable}
					{#if printer.isConnected}
						<button
							onclick={printViaBluetooth}
							disabled={printing}
							class="w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold
								hover:bg-indigo-500 active:scale-[0.97] transition-transform duration-100
								disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<Icon icon="mdi:printer-wireless" class="w-5 h-5 inline mr-2" />
							Print via Bluetooth
						</button>
					{:else}
						<button
							onclick={connectPrinter}
							class="w-full py-3 rounded-xl bg-slate-700 text-white font-semibold
								hover:bg-slate-600 active:scale-[0.97] transition-transform duration-100"
						>
							<Icon icon="mdi:bluetooth-connect" class="w-5 h-5 inline mr-2" />
							Connect Printer
						</button>
					{/if}
				{:else}
					<div class="w-full py-3 px-4 rounded-xl bg-slate-700/50 text-center">
						<p class="text-slate-400 text-sm">
							<Icon icon="mdi:bluetooth-off" class="w-4 h-4 inline mr-1" />
							Bluetooth printing not available on this device
						</p>
						<p class="text-slate-500 text-xs mt-1">
							Use Chrome or Edge on a desktop for Bluetooth printing, or use the options below.
						</p>
					</div>
				{/if}

				<button
					onclick={printViaPdf}
					class="w-full py-3 rounded-xl bg-slate-700 text-white font-semibold
						hover:bg-slate-600 active:scale-[0.97] transition-transform duration-100"
				>
					<Icon icon="mdi:printer" class="w-5 h-5 inline mr-2" />
					Print via System Dialog
				</button>

				<button
					onclick={downloadPng}
					class="w-full py-2.5 rounded-xl bg-slate-700/50 text-slate-300 text-sm
						hover:bg-slate-700 active:scale-[0.97] transition-transform duration-100"
				>
					<Icon icon="mdi:download" class="w-4 h-4 inline mr-1" />
					Download PNG
				</button>
			</div>
		</div>
	</div>
{/if}
