<script lang="ts">
	import Icon from '@iconify/svelte';

	interface Props {
		areas: { id: number; name: string; icon: string }[];
		preselectedAreaId?: number;
		onclose: () => void;
		onsave: (receptacle: SavedReceptacle) => void;
	}

	export interface SavedReceptacle {
		id: number;
		name: string;
		receptacleType: string;
		icon: string;
		areaId: number;
	}

	let { areas, preselectedAreaId, onclose, onsave }: Props = $props();

	const receptacleTypes = [
		{ type: 'Outlet', icon: 'mdi:power-socket-us', description: 'Standard duplex' },
		{ type: 'GFCI Outlet', icon: 'mdi:shield-check', description: 'Ground fault protected' },
		{ type: 'Smart Switch', icon: 'mdi:home-automation', description: 'WiFi/Zigbee switch' },
		{ type: 'Dimmer Switch', icon: 'mdi:brightness-6', description: 'Variable brightness' },
		{ type: 'On/Off Switch', icon: 'mdi:toggle-switch', description: 'Standard toggle' },
		{ type: 'On/Off Relay', icon: 'mdi:relay', description: 'Low-voltage relay' },
		{ type: 'Timer Switch', icon: 'mdi:timer', description: 'Timed on/off' },
		{ type: 'Networking', icon: 'mdi:ethernet', description: 'RJ45 / keystone' },
		{ type: 'Coax', icon: 'mdi:cable-data', description: 'Coaxial connection' },
		{ type: 'Other', icon: 'mdi:help-circle-outline', description: 'Custom type' },
	];

	let selectedAreaId = $state<number | null>(preselectedAreaId ?? null);
	let selectedType = $state<string | null>(null);
	let receptacleName = $state('');
	let nameManuallyEdited = $state(false);
	let saving = $state(false);
	let error = $state('');
	let attempted = $state(false);
	let addAnother = $state(false);

	const selectedRecType = $derived(receptacleTypes.find((r) => r.type === selectedType));

	// Auto-suggest name when type or area changes (unless user manually edited)
	$effect(() => {
		if (selectedType && !nameManuallyEdited) {
			const area = areas.find((a) => a.id === selectedAreaId);
			const prefix = area ? area.name : '';
			receptacleName = prefix ? `${prefix} ${selectedType}` : selectedType;
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
		receptacleName = '';
		nameManuallyEdited = false;
		error = '';
		attempted = false;
	}

	async function save() {
		attempted = true;
		if (!selectedAreaId || !selectedType || !receptacleName.trim()) {
			error = 'Please fill in all required fields';
			return;
		}
		saving = true;
		error = '';

		const fields: Record<string, unknown> = {
			Name: receptacleName.trim(),
			'Receptacle Type': selectedType,
			Icon: selectedRecType?.icon || 'mdi:power-socket-us',
		};

		const body = {
			fields,
			areaId: selectedAreaId
		};

		try {
			const resp = await fetch('/api/nocodb/receptacle', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (resp.ok) {
				const data = await resp.json();
				onsave({
					id: data.id,
					name: receptacleName.trim(),
					receptacleType: selectedType,
					icon: selectedRecType?.icon || 'mdi:power-socket-us',
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
			<h3 class="text-sm font-semibold text-white">Add Receptacle</h3>
			<button onclick={onclose} class="text-slate-400 hover:text-white p-1 min-w-[40px] min-h-[40px] flex items-center justify-center">
				<Icon icon="mdi:close" width={18} />
			</button>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-y-auto p-4 space-y-4">
			<!-- Room picker -->
			<div>
				<label for="area-select-rec" class="text-xs text-slate-500 block mb-1">Room *</label>
				<select
					id="area-select-rec"
					bind:value={selectedAreaId}
					class="w-full bg-slate-900/60 border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-border-color appearance-none {attempted && !selectedAreaId ? 'border-red-500/70' : 'border-slate-600/50'}"
				>
					<option value={null} disabled>Select a room…</option>
					{#each areas as area}
						<option value={area.id}>{area.name}</option>
					{/each}
				</select>
			</div>

			<!-- Receptacle type grid -->
			<div>
				<label class="text-xs block mb-2 {attempted && !selectedType ? 'text-red-400' : 'text-slate-500'}">Type *</label>
				<div class="grid grid-cols-3 gap-1.5">
					{#each receptacleTypes as rt}
						{@const active = selectedType === rt.type}
						<button
							onclick={() => { selectedType = rt.type; }}
							class="flex flex-col items-center gap-1 p-2.5 rounded-lg text-center transition-background-color,transform active:scale-[0.94] min-h-[40px] {active ? 'bg-blue-600/20 ring-1 ring-blue-500' : 'bg-slate-700/40 hover:bg-slate-700/70'}"
						>
							<Icon icon={rt.icon} width={20} class="{active ? 'text-blue-400' : 'text-slate-400'}" />
							<span class="text-[10px] leading-tight {active ? 'text-blue-300' : 'text-slate-500'}">{rt.type}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Name -->
			<div>
				<label for="rec-name" class="text-xs text-slate-500 block mb-1">Name *</label>
				<input
					id="rec-name"
					type="text"
					bind:value={receptacleName}
					oninput={() => { nameManuallyEdited = true; }}
					placeholder="e.g. Kitchen Counter GFCI"
					class="w-full bg-slate-900/60 border rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-border-color {attempted && !receptacleName.trim() ? 'border-red-500/70' : 'border-slate-600/50'}"
				/>
			</div>

			<!-- Type description hint -->
			{#if selectedRecType}
				<div class="flex items-center gap-2 text-xs text-slate-500">
					<Icon icon={selectedRecType.icon} width={13} class="text-blue-400" />
					<span>{selectedRecType.description}</span>
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
				disabled={saving || !selectedAreaId || !selectedType || !receptacleName.trim()}
				class="flex-1 bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-blue-500 transition-background-color active:scale-[0.96] disabled:opacity-40 min-h-[40px]"
			>
				{saving ? 'Saving…' : 'Add Receptacle'}
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
