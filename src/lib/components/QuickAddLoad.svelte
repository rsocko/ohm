<script lang="ts">
	import Icon from '@iconify/svelte';

	interface Props {
		areas: { id: number; name: string; icon: string }[];
		preselectedAreaId?: number;
		onclose: () => void;
		onsave: (load: SavedLoad) => void;
	}

	export interface SavedLoad {
		id: number;
		name: string;
		deviceType: string;
		icon: string;
		areaId: number;
	}

	let { areas, preselectedAreaId, onclose, onsave }: Props = $props();

	const deviceTypes = [
		{ type: 'Light - Ceiling', icon: 'mdi:ceiling-light', wattage: 60 },
		{ type: 'Light - Wall Mounted', icon: 'mdi:wall-sconce', wattage: 40 },
		{ type: 'Lamp/Other Light', icon: 'mdi:lamp', wattage: 60 },
		{ type: 'Ceiling Fan/Light', icon: 'mdi:ceiling-fan-light', wattage: 75 },
		{ type: 'Appliance', icon: 'mdi:dishwasher', wattage: 1200 },
		{ type: 'Electronics', icon: 'mdi:monitor', wattage: 150 },
		{ type: 'Camera', icon: 'mdi:cctv', wattage: 15 },
		{ type: 'Vent Fan', icon: 'mdi:fan', wattage: 80 },
		{ type: 'Networking', icon: 'mdi:router-wireless', wattage: 30 },
		{ type: 'HVAC', icon: 'mdi:radiator', wattage: 1500 },
		{ type: 'EV Charger', icon: 'mdi:ev-station', wattage: 7680 },
		{ type: 'Smoke/CO Detector', icon: 'mdi:smoke-detector-variant', wattage: 5 },
		{ type: 'Doorbell', icon: 'mdi:doorbell-video', wattage: 15 }
	];

	let selectedAreaId = $state<number | null>(preselectedAreaId ?? null);
	let selectedType = $state<string | null>(null);
	let loadName = $state('');
	let nameManuallyEdited = $state(false);
	let saving = $state(false);
	let error = $state('');
	let attempted = $state(false);
	let addAnother = $state(false);

	// Receptacles for selected area
	let receptacles = $state<{ id: number; name: string }[]>([]);
	let selectedReceptacleId = $state<number | null>(null);
	let loadingReceptacles = $state(false);

	const selectedDeviceType = $derived(deviceTypes.find((d) => d.type === selectedType));

	// Auto-suggest name when type or area changes (unless user manually edited)
	$effect(() => {
		if (selectedType && !nameManuallyEdited) {
			const area = areas.find((a) => a.id === selectedAreaId);
			const prefix = area ? area.name : '';
			loadName = prefix ? `${prefix} ${selectedType.split(' - ').pop() || selectedType}` : selectedType;
		}
	});

	async function loadReceptacles(areaId: number) {
		loadingReceptacles = true;
		try {
			const resp = await fetch(`/api/nocodb?action=records&table=Receptacle&limit=100`);
			if (resp.ok) {
				const data = await resp.json();
				receptacles = (data.records || [])
					.filter((r: { fields: Record<string, unknown> }) => {
						const area = r.fields.Area as { id: number } | undefined;
						return area && area.id === areaId;
					})
					.map((r: { id: number; fields: Record<string, unknown> }) => ({
						id: r.id,
						name: (r.fields.Name as string) || `Receptacle #${r.id}`
					}));
			}
		} catch { /* silent */ }
		finally { loadingReceptacles = false; }
	}

	$effect(() => {
		if (selectedAreaId) {
			loadReceptacles(selectedAreaId);
		} else {
			receptacles = [];
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !saving) {
			e.preventDefault();
			save();
		}
	}

	function resetForm() {
		selectedType = null;
		loadName = '';
		nameManuallyEdited = false;
		error = '';
		attempted = false;
		selectedReceptacleId = null;
	}

	async function save() {
		attempted = true;
		if (!selectedAreaId || !selectedType || !loadName.trim()) {
			error = 'Please fill in all required fields';
			return;
		}
		saving = true;
		error = '';

		const fields: Record<string, unknown> = {
			Name: loadName.trim(),
			'Device Type': selectedType,
			Icon: selectedDeviceType?.icon || 'mdi:power-plug',
			Status: 'Connected',
			Wattage: selectedDeviceType?.wattage || null
		};

		const body: Record<string, unknown> = {
			table: 'Load',
			fields,
			areaId: selectedAreaId
		};

		try {
			const resp = await fetch('/api/nocodb/load', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (resp.ok) {
				const data = await resp.json();
				onsave({
					id: data.id,
					name: loadName.trim(),
					deviceType: selectedType,
					icon: selectedDeviceType?.icon || 'mdi:power-plug',
					areaId: selectedAreaId
				});
				if (addAnother) {
					resetForm();
				}
			} else {
				const data = await resp.json();
				error = data.error || 'Failed to save';
			}
		} catch (e) {
			error = String(e);
		} finally {
			saving = false;
		}
	}
</script>

<!-- Bottom sheet -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onkeydown={handleKeydown}>
	<!-- Backdrop -->
	<button
		class="absolute inset-0 bg-black/60 backdrop-blur-sm"
		onclick={onclose}
		aria-label="Close"
		tabindex="-1"
	></button>

	<!-- Sheet -->
	<div class="relative w-full max-w-md max-h-[85vh] bg-slate-800 border border-slate-700 rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden shadow-2xl">
		<!-- Header -->
		<div class="flex items-center justify-between px-4 py-3 border-b border-slate-700/60">
			<h3 class="text-sm font-semibold text-white">Add Load</h3>
			<button onclick={onclose} class="text-slate-400 hover:text-white p-1 min-w-[40px] min-h-[40px] flex items-center justify-center">
				<Icon icon="mdi:close" width={18} />
			</button>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-y-auto p-4 space-y-4">
			<!-- Room picker -->
			<div>
				<label for="area-select" class="text-xs text-slate-500 block mb-1">Room *</label>
				<select
					id="area-select"
					bind:value={selectedAreaId}
					class="w-full bg-slate-900/60 border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-border-color appearance-none {attempted && !selectedAreaId ? 'border-red-500/70' : 'border-slate-600/50'}"
				>
					<option value={null} disabled>Select a room…</option>
					{#each areas as area}
						<option value={area.id}>{area.name}</option>
					{/each}
				</select>
			</div>

			<!-- Receptacle picker (optional) -->
			{#if selectedAreaId}
				<div>
					<label for="rec-select" class="text-xs text-slate-500 block mb-1">Receptacle (optional)</label>
					{#if loadingReceptacles}
						<p class="text-xs text-slate-600">Loading…</p>
					{:else if receptacles.length === 0}
						<p class="text-xs text-slate-600">No receptacles in this room</p>
					{:else}
						<select
							id="rec-select"
							bind:value={selectedReceptacleId}
							class="w-full bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-border-color appearance-none"
						>
							<option value={null}>None / Not plugged in</option>
							{#each receptacles as rec}
								<option value={rec.id}>{rec.name}</option>
							{/each}
						</select>
					{/if}
				</div>
			{/if}

			<!-- Device type grid -->
			<div>
				<label class="text-xs block mb-2 {attempted && !selectedType ? 'text-red-400' : 'text-slate-500'}">Device Type *</label>
				<div class="grid grid-cols-4 gap-1.5">
					{#each deviceTypes as dt}
						{@const active = selectedType === dt.type}
						<button
							onclick={() => { selectedType = dt.type; }}
							class="flex flex-col items-center gap-1 p-2 rounded-lg text-center transition-background-color,transform active:scale-[0.94] min-h-[40px] {active ? 'bg-blue-600/20 ring-1 ring-blue-500' : 'bg-slate-700/40 hover:bg-slate-700/70'}"
						>
							<Icon icon={dt.icon} width={20} class="{active ? 'text-blue-400' : 'text-slate-400'}" />
							<span class="text-[10px] leading-tight {active ? 'text-blue-300' : 'text-slate-500'}">{dt.type.split(' - ').pop() || dt.type}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Name -->
			<div>
				<label for="load-name" class="text-xs text-slate-500 block mb-1">Name *</label>
				<input
					id="load-name"
					type="text"
					bind:value={loadName}
					oninput={() => { nameManuallyEdited = true; }}
					placeholder="e.g. Kitchen Ceiling Light"
					class="w-full bg-slate-900/60 border rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-border-color {attempted && !loadName.trim() ? 'border-red-500/70' : 'border-slate-600/50'}"
				/>
			</div>

			<!-- Wattage hint -->
			{#if selectedDeviceType}
				<div class="flex items-center gap-2 text-xs text-slate-500">
					<Icon icon="lucide:plug-zap" width={13} class="text-amber-400" />
					<span>Estimated: ~{selectedDeviceType.wattage}W</span>
				</div>
			{/if}

			<!-- Add another toggle -->
			<label class="flex items-center gap-2 cursor-pointer">
				<input type="checkbox" bind:checked={addAnother} class="w-3.5 h-3.5 rounded border-slate-600 bg-slate-900/60 text-blue-500 focus:ring-blue-500/30" />
				<span class="text-xs text-slate-400">Add another after saving</span>
			</label>

			<!-- Error -->
			{#if error}
				<p class="text-xs text-red-400">{error}</p>
			{/if}
		</div>

		<!-- Footer -->
		<div class="px-4 py-3 border-t border-slate-700/60 flex gap-2">
			<button
				onclick={save}
				disabled={saving || !selectedAreaId || !selectedType || !loadName.trim()}
				class="flex-1 bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-blue-500 transition-background-color active:scale-[0.96] disabled:opacity-40 min-h-[40px]"
			>
				{saving ? 'Saving…' : 'Add Load'}
			</button>
			<button
				onclick={onclose}
				class="px-4 text-sm text-slate-400 hover:text-white transition-color min-h-[40px]"
			>
				Cancel
			</button>
		</div>
	</div>
</div>
