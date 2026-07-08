<script lang="ts">
	/**
	 * EntityPicker — HA entity picker with search, inspired by native HA UI.
	 * Shows friendly name, entity_id, current state/value.
	 * Filters to power sensors by default.
	 */
	import Icon from '@iconify/svelte';

	interface PickerEntity {
		entityId: string;
		friendlyName: string;
		state: string;
		unitOfMeasurement: string;
		deviceClass: string | null;
	}

	interface Props {
		value?: string;
		onselect?: (entityId: string, entity: PickerEntity) => void;
		placeholder?: string;
		domain?: string;
		deviceClass?: 'power' | 'energy' | 'both';
		disabled?: boolean;
	}

	let { value = $bindable(''), onselect, placeholder = 'Search entities…', domain = 'sensor', deviceClass = 'both', disabled = false }: Props = $props();

	let open = $state(false);
	let search = $state('');
	let entities: PickerEntity[] = $state([]);
	let loading = $state(false);
	let loaded = $state(false);
	let inputEl: HTMLInputElement | undefined = $state();

	// Load entities on mount if we already have a value (so we can show friendly name)
	$effect(() => {
		if (value && !loaded && !loading) {
			loadEntities();
		}
	});

	const filtered = $derived(
		search.trim()
			? entities.filter((e) => {
					const q = search.toLowerCase();
					return (
						e.friendlyName.toLowerCase().includes(q) ||
						e.entityId.toLowerCase().includes(q)
					);
				})
			: entities
	);

	const selectedEntity = $derived(entities.find((e) => e.entityId === value));

	function formatState(state: string): string {
		const num = parseFloat(state);
		if (isNaN(num)) return state;
		if (Math.abs(num) >= 100) return num.toFixed(0);
		if (Math.abs(num) >= 10) return num.toFixed(1);
		return num.toFixed(1);
	}

	async function loadEntities() {
		if (loaded) return;
		loading = true;
		try {
			const resp = await fetch(`/api/ha/entities?domain=${domain}`);
			if (!resp.ok) throw new Error('Failed to load entities');
			const data = await resp.json();
			// Transform from ha-client format to picker format
			entities = (data.entities || [])
				.filter((e: Record<string, unknown>) => {
					const attrs = e.attributes as Record<string, unknown> | undefined;
						if (deviceClass === 'power') return attrs?.device_class === 'power';
						if (deviceClass === 'energy') return attrs?.device_class === 'energy';
						return attrs?.device_class === 'power' || attrs?.device_class === 'energy';
					})
				.map((e: Record<string, unknown>) => {
					const attrs = e.attributes as Record<string, unknown> | undefined;
					return {
						entityId: e.entity_id as string,
						friendlyName: (attrs?.friendly_name as string) || (e.entity_id as string),
						state: e.state as string,
						unitOfMeasurement: (attrs?.unit_of_measurement as string) || 'W',
						deviceClass: (attrs?.device_class as string) || null
					};
				})
				.sort((a: PickerEntity, b: PickerEntity) => a.friendlyName.localeCompare(b.friendlyName));
			loaded = true;
		} catch {
			entities = [];
		} finally {
			loading = false;
		}
	}

	function handleOpen() {
		if (disabled) return;
		open = true;
		loadEntities();
		setTimeout(() => inputEl?.focus(), 50);
	}

	function handleSelect(entity: PickerEntity) {
		value = entity.entityId;
		open = false;
		search = '';
		onselect?.(entity.entityId, entity);
	}

	function handleClear(e: Event) {
		e.stopPropagation();
		value = '';
		onselect?.('', {} as PickerEntity);
	}
</script>

<div class="relative">
	<!-- Trigger / Display -->
	{#if !open}
		<button
			type="button"
			onclick={handleOpen}
			{disabled}
			class="flex w-full items-center gap-2 rounded-xl bg-slate-800/60 px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_rgba(148,163,184,0.1)] transition-all hover:shadow-[inset_0_0_0_1px_rgba(96,165,250,0.3)] disabled:opacity-40"
		>
			<Icon icon="mdi:home-assistant" width={18} class="shrink-0 text-sky-400" />
			{#if selectedEntity}
					<div class="flex-1 min-w-0" title="{selectedEntity.friendlyName}\n{selectedEntity.entityId}">
					<p class="text-sm font-medium text-white truncate">{selectedEntity.friendlyName}</p>
					<p class="text-[10px] text-slate-500 truncate">{selectedEntity.entityId}</p>
				</div>
				<span class="shrink-0 text-xs font-semibold text-emerald-300" style="font-variant-numeric: tabular-nums;">
						{formatState(selectedEntity.state)} {selectedEntity.unitOfMeasurement}
				</span>
				<button
					type="button"
					onclick={handleClear}
					class="shrink-0 flex h-6 w-6 items-center justify-center rounded-md bg-slate-700/80 text-slate-400 hover:text-red-300 transition-colors"
				>
					<Icon icon="mdi:close" width={12} />
				</button>
			{:else if value}
				<span class="flex-1 text-sm text-slate-300 truncate">{value}</span>
				<button
					type="button"
					onclick={handleClear}
					class="shrink-0 flex h-6 w-6 items-center justify-center rounded-md bg-slate-700/80 text-slate-400 hover:text-red-300 transition-colors"
				>
					<Icon icon="mdi:close" width={12} />
				</button>
			{:else}
				<span class="flex-1 text-sm text-slate-500">{placeholder}</span>
				<Icon icon="mdi:chevron-down" width={16} class="shrink-0 text-slate-500" />
			{/if}
		</button>
	{:else}
		<!-- Expanded Search -->
		<div class="rounded-xl bg-slate-800 shadow-[0_18px_42px_rgba(2,6,23,0.6),inset_0_0_0_1px_rgba(148,163,184,0.12)] overflow-hidden">
			<!-- Search Input -->
			<div class="flex items-center gap-2 border-b border-slate-700/50 px-3 py-2.5">
				<Icon icon="mdi:magnify" width={16} class="shrink-0 text-slate-400" />
				<input
					bind:this={inputEl}
					bind:value={search}
					type="text"
					placeholder="Search by name or entity ID…"
					class="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
					onkeydown={(e) => { if (e.key === 'Escape') { open = false; search = ''; } }}
				/>
				<button
					type="button"
					onclick={() => { open = false; search = ''; }}
					class="shrink-0 text-xs text-slate-400 hover:text-white transition-colors"
				>
					ESC
				</button>
			</div>

			<!-- Results -->
			<div class="max-h-64 overflow-y-auto overscroll-contain">
				{#if loading}
					<div class="flex items-center justify-center py-8">
						<Icon icon="mdi:loading" width={20} class="animate-spin text-slate-400" />
						<span class="ml-2 text-sm text-slate-400">Loading entities…</span>
					</div>
				{:else if filtered.length === 0}
					<div class="py-6 text-center text-sm text-slate-500">
						{search ? 'No matching entities' : 'No power entities found'}
					</div>
				{:else}
					{#each filtered as entity}
						<button
							type="button"
							onclick={() => handleSelect(entity)}
							class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-700/40 {entity.entityId === value ? 'bg-blue-500/10' : ''}"
						>
							<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-700/60">
								<Icon
									icon={entity.deviceClass === 'energy' ? 'mdi:lightning-bolt' : 'mdi:flash'}
									width={16}
									class="text-amber-400"
								/>
							</div>
							<div class="flex-1 min-w-0" title="{entity.friendlyName}\n{entity.entityId}">
								<p class="text-sm text-white truncate">{entity.friendlyName}</p>
								<p class="text-[10px] text-slate-500 truncate">{entity.entityId}</p>
							</div>
							<span
								class="shrink-0 text-xs font-semibold {parseFloat(entity.state) > 0 ? 'text-emerald-300' : 'text-slate-500'}"
								style="font-variant-numeric: tabular-nums;"
							>
									{formatState(entity.state)} {entity.unitOfMeasurement}
							</span>
							{#if entity.entityId === value}
								<Icon icon="mdi:check-circle" width={16} class="shrink-0 text-blue-400" />
							{/if}
						</button>
					{/each}
				{/if}
			</div>

			<!-- Footer -->
			{#if loaded && !loading}
				<div class="border-t border-slate-700/50 px-3 py-2 text-[10px] text-slate-500">
					{filtered.length} of {entities.length} entities
				</div>
			{/if}
		</div>
	{/if}
</div>
