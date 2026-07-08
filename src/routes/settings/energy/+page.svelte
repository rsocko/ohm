<script lang="ts">
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	import EntityPicker from '$lib/components/energy/EntityPicker.svelte';
	import type { HAEntity } from '$lib/types/energy';

	interface MappableCircuit {
		id: number;
		name: string;
		number: number;
		panelName: string;
		powerEntityId: string | null;
		energyEntityId: string | null;
		energyMonitored: boolean;
		amps: number;
	}

	interface MappingData {
		mappings: { circuitId: number; circuitName: string; panelName: string; entityId: string }[];
		unmappedEntities: HAEntity[];
		haConnected: boolean;
		circuits: MappableCircuit[];
	}

	let data: MappingData | null = $state(null);
	let loading = $state(true);
	let error = $state('');
	let saving = $state(false);
	let filter: 'monitored' | 'all' | 'mapped' = $state('monitored');

	const filteredCircuits = $derived.by(() => {
		if (!data) return [] as MappableCircuit[];
		switch (filter) {
			case 'monitored': return data.circuits.filter(c => c.energyMonitored);
			case 'mapped': return data.circuits.filter(c => c.powerEntityId || c.energyEntityId);
			case 'all': return data.circuits;
		}
	});

	const mappedCount = $derived.by(() => data ? data.circuits.filter(c => c.powerEntityId || c.energyEntityId).length : 0);
	const monitoredCount = $derived.by(() => data ? data.circuits.filter(c => c.energyMonitored).length : 0);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		loading = true;
		error = '';
		try {
			const resp = await fetch('/api/energy/mapping');
			if (!resp.ok) throw new Error('Failed to load mappings');
			data = await resp.json();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	async function saveMapping(circuitId: number, entityId: string, type: 'power' | 'energy' = 'power') {
		saving = true;
		try {
			if (entityId) {
				const resp = await fetch('/api/energy/mapping', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ circuitId, entityId, type })
				});
				if (!resp.ok) throw new Error('Failed to save mapping');
			} else {
				const resp = await fetch(`/api/energy/mapping?circuit_id=${circuitId}&type=${type}`, { method: 'DELETE' });
				if (!resp.ok) throw new Error('Failed to remove mapping');
			}
			await loadData();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-4">
	<header class="flex items-center gap-2.5">
		<a href="/settings" class="text-fg-faint hover:text-fg-secondary transition-colors shrink-0" aria-label="Back to Settings">
			<Icon icon="mdi:arrow-left" width={20} />
		</a>
		<Icon icon="mdi:swap-horizontal-bold" width={22} class="text-[#22D3EE]" />
		<div class="min-w-0">
			<h1 class="text-xl font-bold text-fg leading-tight">Energy Mapping</h1>
			<p class="text-sm text-fg-muted">Link circuits to HA power sensors</p>
		</div>
	</header>

	{#if loading}
		<div class="flex items-center justify-center py-12">
			<Icon icon="mdi:loading" width={24} class="animate-spin text-slate-400" />
		</div>
	{:else if error}
		<div class="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-300">
			{error}
		</div>
	{:else if data}
		<!-- Status Row -->
		<div class="flex items-center gap-3 rounded-xl bg-slate-800/60 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.08)]">
			<span class="h-2.5 w-2.5 rounded-full {data.haConnected ? 'bg-green-400' : 'bg-red-400'}"></span>
			<span class="text-sm {data.haConnected ? 'text-green-200' : 'text-red-200'}">
				HA {data.haConnected ? 'Connected' : 'Offline'}
			</span>
			<span class="ml-auto text-xs text-slate-400" style="font-variant-numeric: tabular-nums;">
				{mappedCount}/{monitoredCount} mapped
			</span>
		</div>

		<!-- Filter Tabs -->
		<div class="flex gap-1 rounded-lg bg-slate-800/40 p-1">
			<button
				onclick={() => { filter = 'monitored'; }}
				class="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors {filter === 'monitored' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'}"
			>
				Energy Monitored ({monitoredCount})
			</button>
			<button
				onclick={() => { filter = 'mapped'; }}
				class="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors {filter === 'mapped' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-white'}"
			>
				Mapped ({mappedCount})
			</button>
			<button
				onclick={() => { filter = 'all'; }}
				class="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors {filter === 'all' ? 'bg-slate-500/20 text-white' : 'text-slate-400 hover:text-white'}"
			>
				All ({data.circuits.length})
			</button>
		</div>

		<!-- Circuit List with Entity Pickers -->
		<div class="space-y-3">
			{#each filteredCircuits as circuit (circuit.id)}
				<div class="rounded-xl bg-slate-800/60 p-3 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.08)]">
					<div class="flex items-center gap-2 mb-2">
						<span class="text-xs font-bold text-slate-400" style="font-variant-numeric: tabular-nums;">#{circuit.number}</span>
						<span class="text-sm font-medium text-white truncate">{circuit.name}</span>
						{#if circuit.energyMonitored}
							<span class="shrink-0" title="Energy Monitored"><Icon icon="mdi:flash" width={14} class="text-emerald-400" /></span>
						{/if}
						<span class="ml-auto text-[10px] text-slate-500">{circuit.panelName}</span>
						<span class="text-[10px] px-1 py-0 rounded font-mono font-bold bg-slate-700 text-slate-300" style="font-variant-numeric: tabular-nums;">{circuit.amps}A</span>
					</div>
					<div class="space-y-2">
							<div>
								<p class="text-[9px] text-slate-500 mb-0.5">Power (live W)</p>
								<EntityPicker
									value={circuit.powerEntityId || ''}
									onselect={(entityId) => saveMapping(circuit.id, entityId, 'power')}
									placeholder="Select power sensor…"
									deviceClass="power"
									disabled={saving}
								/>
							</div>
							<div>
								<p class="text-[9px] text-slate-500 mb-0.5">Energy (daily kWh)</p>
								<EntityPicker
									value={circuit.energyEntityId || ''}
									onselect={(entityId) => saveMapping(circuit.id, entityId, 'energy')}
									placeholder="Select energy sensor…"
									deviceClass="energy"
									disabled={saving}
								/>
							</div>
						</div>
				</div>
			{/each}

			{#if filteredCircuits.length === 0}
				<p class="py-8 text-center text-sm text-slate-500">No circuits match this filter</p>
			{/if}
		</div>

		<!-- Tip -->
		<div class="rounded-xl bg-slate-800/30 px-4 py-3 text-xs text-slate-500">
			<p><strong class="text-slate-400">Tip:</strong> You can also map circuits directly from the <a href="/panels" class="text-indigo-400 hover:underline">Panels</a> page by expanding any energy-monitored circuit.</p>
		</div>
	{/if}
</div>
