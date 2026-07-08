<script lang="ts">
	/**
	 * Unified inline device editor for loads and receptacles.
	 * Fetches record by ID if not provided, displays edit form, saves via PATCH.
	 *
	 * Used by: Devices page (inline, passes loadId only), Rooms page (inline, passes record directly).
	 */
	import Icon from '@iconify/svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import {
		loadTypeConfig,
		receptacleTypeConfig,
		networkRoleOptions,
		powerSourceOptions,
		type V3Record
	} from '$lib/config/device-types';

	interface Props {
		/** NocoDB record ID — used to fetch if no record prop given */
		recordId: number;
		/** 'load' or 'receptacle' — determines which type options to show */
		deviceType?: 'load' | 'receptacle';
		/** If the parent already has the full record, pass it to skip fetch */
		record?: V3Record;
		/** All loads for upstream picker (optional — only shown if provided) */
		allLoads?: V3Record[];
		onClose: () => void;
		/** Called after successful save with the changed fields object for optimistic update */
		onSaved?: (fields: Record<string, unknown>) => void;
	}

	let {
		recordId,
		deviceType = 'load',
		record: recordProp,
		allLoads = [],
		onClose,
		onSaved
	}: Props = $props();

	let loading = $state(!recordProp);
	let saving = $state(false);
	let fields: Record<string, unknown> = $state(recordProp?.fields ? { ...recordProp.fields } : {});

	// Edit state
	let editName = $state('');
	let editType = $state('');
	let editIcon = $state('');
	let editQty = $state(1);
	let editDisplayMode: 'single' | 'expanded' = $state('single');
	let editRole = $state('');
	let editPowerSource = $state('');
	let editMatchKey = $state('');
	let editNetworkUpstreamId: number | null = $state(null);
	let editNetworkSearch = $state('');
	let showIconPicker = $state(false);
	const typeField = deviceType === 'load' ? 'Device Type' : 'Receptacle Type';
	const typeConfig = deviceType === 'load' ? loadTypeConfig : receptacleTypeConfig;

	function getDisplayName(rec: V3Record): string {
		return (rec.fields['Display Name'] as string) || (rec.fields.Name as string) || `#${rec.id}`;
	}

	function getNetworkUpstreamId(f: Record<string, unknown>): number | null {
		const upstream = f.Network_Upstream;
		if (Array.isArray(upstream) && upstream.length > 0) {
			const first = upstream[0];
			if (typeof first === 'object' && first !== null && 'id' in first) return (first as any).id;
			if (typeof first === 'number') return first;
		}
		return null;
	}

	function initFromFields(f: Record<string, unknown>) {
		editName = (f['Display Name'] as string) || (f.Name as string) || '';
		editType = (f[typeField] as string) || '';
		editIcon = (f.Icon as string) || '';
		editQty = (f.Fixture_Count as number) || 1;
		editDisplayMode = (f.Display_Mode as 'single' | 'expanded') || 'single';
		editRole = (f.Network_Role as string) || '';
		editPowerSource = (f.Power_Source as string) || 'Circuit';
		editMatchKey = (f.Network_Match_Key as string) || '';
		editNetworkUpstreamId = getNetworkUpstreamId(f);
		if (editNetworkUpstreamId) {
			const upstream = allLoads.find(l => l.id === editNetworkUpstreamId);
			editNetworkSearch = upstream ? getDisplayName(upstream) : '';
		}
	}

	async function fetchRecord() {
		try {
			const resp = await fetch(`/api/nocodb?action=record&table=${deviceType === 'load' ? 'Load' : 'Receptacle'}&id=${recordId}`);
			if (resp.ok) {
				const data = await resp.json();
				if (data.record) {
					fields = data.record.fields;
					initFromFields(fields);
				}
			}
		} catch {} finally { loading = false; }
	}

	function getFilteredUpstreamLoads(): V3Record[] {
		const q = editNetworkSearch.trim().toLowerCase();
		return allLoads
			.filter(c => c.id !== recordId)
			.filter(c => {
				if (!q) return true;
				const name = getDisplayName(c).toLowerCase();
				const type = ((c.fields['Device Type'] as string) || '').toLowerCase();
				return name.includes(q) || type.includes(q);
			})
			.sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));
	}

	async function save() {
		if (!editName.trim()) return;
		saving = true;
		const table = deviceType === 'load' ? 'Load' : 'Receptacle';
		const changedFields: Record<string, unknown> = {};
		const linkUpdates: { title: string; ids: number[] }[] = [];

		// Always send name
		changedFields['Display Name'] = editName.trim();

		const origType = (fields[typeField] as string) || '';
		if (editType !== origType) changedFields[typeField] = editType || null;

		const origIcon = (fields.Icon as string) || '';
		if (editIcon !== origIcon) changedFields['Icon'] = editIcon || null;

		if (deviceType === 'load') {
			const origCount = (fields.Fixture_Count as number) || 1;
			if (editQty !== origCount) changedFields['Fixture_Count'] = editQty;

			const origMode = (fields.Display_Mode as string) || 'single';
			if (editDisplayMode !== origMode) changedFields['Display_Mode'] = editDisplayMode;

			const origRole = (fields.Network_Role as string) || '';
			if (editRole !== origRole) changedFields['Network_Role'] = editRole || null;

			const origPower = (fields.Power_Source as string) || '';
			if (editPowerSource !== origPower) changedFields['Power_Source'] = editPowerSource || null;

			const origMatch = (fields.Network_Match_Key as string) || '';
			if (editMatchKey.trim() !== origMatch) changedFields['Network_Match_Key'] = editMatchKey.trim() || null;

			const origUpstream = getNetworkUpstreamId(fields);
			if ((editNetworkUpstreamId || null) !== (origUpstream || null)) {
				linkUpdates.push({ title: 'Network_Upstream', ids: editNetworkUpstreamId ? [editNetworkUpstreamId] : [] });
			}
		}

		try {
			const resp = await fetch('/api/nocodb', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table, id: recordId, fields: changedFields, linkUpdates })
			});
			if (resp.ok) {
				// Build complete updated fields for optimistic UI
				const updatedFields = { ...changedFields };
				if (deviceType === 'load' && linkUpdates.length > 0) {
					updatedFields['Network_Upstream'] = editNetworkUpstreamId
						? [allLoads.find(l => l.id === editNetworkUpstreamId)].filter(Boolean)
						: [];
				}
				onSaved?.(updatedFields);
				onClose();
			}
		} catch {} finally { saving = false; }
	}

	// Initialize from provided record or fetch
	$effect(() => {
		if (recordProp) {
			fields = { ...recordProp.fields };
			initFromFields(fields);
		} else {
			fetchRecord();
		}
	});
</script>

{#if loading}
	<div class="px-3 py-4 text-center">
		<span class="text-xs text-slate-400 animate-pulse">Loading…</span>
	</div>
{:else}
	<div class="px-3 pb-3 space-y-2.5 border-t border-slate-700/40 pt-3">
		<!-- Name -->
		<div class="flex gap-2 items-center">
			<label class="text-[10px] text-slate-500 w-12 shrink-0">Name</label>
			<input
				type="text"
				bind:value={editName}
				placeholder="Display name"
				class="flex-1 bg-slate-800 border border-slate-600/50 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 transition-border-color"
				onkeydown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onClose(); }}
			/>
		</div>

		<!-- Type -->
		<div class="flex gap-2 items-center">
			<label class="text-[10px] text-slate-500 w-12 shrink-0">Type</label>
			<select
				bind:value={editType}
				class="flex-1 bg-slate-800 border border-slate-600/50 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 appearance-none"
			>
				<option value="">— None —</option>
				{#each Object.entries(typeConfig) as [key, cfg]}
					<option value={key}>{cfg.label}</option>
				{/each}
			</select>
		</div>

		<!-- Icon -->
		<div class="flex gap-2 items-center">
			<label class="text-[10px] text-slate-500 w-12 shrink-0">Icon</label>
			<button
				onclick={() => { showIconPicker = true; }}
				class="flex-1 flex items-center gap-2 bg-slate-800 border border-slate-600/50 rounded-md px-2.5 py-1.5 hover:border-slate-500 transition-border-color"
			>
				{#if editIcon}
					<Icon icon={editIcon} width={14} class="text-white/80" />
					<span class="text-xs text-slate-300 flex-1 text-left font-mono truncate">{editIcon}</span>
				{:else}
					<Icon icon={editType ? (typeConfig[editType]?.icon || 'mdi:help-circle-outline') : 'mdi:lightbulb-outline'} width={14} class="text-white/40" />
					<span class="text-xs text-slate-500 flex-1 text-left">Default</span>
				{/if}
				<span class="text-[10px] text-slate-500">Change</span>
			</button>
			{#if editIcon}
				<button onclick={() => { editIcon = ''; }} class="text-[10px] text-slate-500 hover:text-red-400 transition-color" title="Clear override">✕</button>
			{/if}
		</div>

		<!-- Load-only fields -->
		{#if deviceType === 'load'}
			<!-- Qty + Display Mode -->
			<div class="flex gap-2 items-center">
				<label class="text-[10px] text-slate-500 w-12 shrink-0">Qty</label>
				<input
					type="number"
					min="1"
					max="50"
					bind:value={editQty}
					class="w-16 bg-slate-800 border border-slate-600/50 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 transition-border-color"
				/>
				<label class="text-[10px] text-slate-500 ml-2 shrink-0">Show</label>
				<button
					onclick={() => { editDisplayMode = editDisplayMode === 'single' ? 'expanded' : 'single'; }}
					class="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs transition-all {editDisplayMode === 'expanded' ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50' : 'bg-slate-800 text-slate-400 border border-slate-600/50 hover:border-slate-500'}"
				>
					<Icon icon={editDisplayMode === 'expanded' ? 'mdi:eye' : 'mdi:eye-off'} width={12} />
					{editDisplayMode === 'expanded' ? 'Always' : 'On tap'}
				</button>
			</div>

			<!-- Role -->
			<div class="flex gap-2 items-center">
				<label class="text-[10px] text-slate-500 w-12 shrink-0">Role</label>
				<select
					bind:value={editRole}
					class="flex-1 bg-slate-800 border border-slate-600/50 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 appearance-none"
				>
					<option value="">— None —</option>
					{#each networkRoleOptions as role}
						<option value={role}>{role}</option>
					{/each}
				</select>
			</div>

			<!-- Power Source -->
			<div class="flex gap-2 items-center">
				<label class="text-[10px] text-slate-500 w-12 shrink-0">Power</label>
				<select
					bind:value={editPowerSource}
					class="flex-1 bg-slate-800 border border-slate-600/50 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 appearance-none"
				>
					{#each powerSourceOptions as source}
						<option value={source}>{source}</option>
					{/each}
				</select>
			</div>

			<!-- Network Upstream (only if allLoads provided) -->
			{#if allLoads.length > 0}
				<div class="space-y-2">
					<div class="flex gap-2 items-center">
						<label class="text-[10px] text-slate-500 w-12 shrink-0">Upstream</label>
						<input
							type="search"
							bind:value={editNetworkSearch}
							placeholder="Search loads"
							class="flex-1 bg-slate-800 border border-slate-600/50 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 transition-border-color"
						/>
					</div>
					<div class="pl-14">
						<select
							bind:value={editNetworkUpstreamId}
							class="w-full bg-slate-800 border border-slate-600/50 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 appearance-none"
						>
							<option value={null}>— No upstream —</option>
							{#each getFilteredUpstreamLoads() as candidate}
								<option value={candidate.id}>{getDisplayName(candidate)}</option>
							{/each}
						</select>
					</div>
				</div>
			{/if}

			<!-- Match Key -->
			<div class="flex gap-2 items-center">
				<label class="text-[10px] text-slate-500 w-12 shrink-0">Match</label>
				<input
					type="text"
					bind:value={editMatchKey}
					placeholder="MAC / UniFi ID"
					class="flex-1 bg-slate-800 border border-slate-600/50 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 transition-border-color"
				/>
			</div>
		{/if}

		<!-- Actions -->
		<div class="flex gap-2 items-center pt-1">
			<button onclick={save} disabled={saving || !editName.trim()} class="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 transition-background-color active:scale-[0.96] disabled:opacity-50">
				{saving ? 'Saving…' : 'Save'}
			</button>
			<button onclick={onClose} class="px-2 py-1.5 text-xs text-slate-400 hover:text-white transition-color">Cancel</button>
		</div>
	</div>
{/if}

{#if showIconPicker}
	<IconPicker
		value={editIcon}
		onselect={(icon) => { editIcon = icon; showIconPicker = false; }}
		onclose={() => { showIconPicker = false; }}
	/>
{/if}
