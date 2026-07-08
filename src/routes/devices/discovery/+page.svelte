<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { toast } from 'svelte-sonner';
	import type { DiscoveryItem, DiscoveryResponse } from '$lib/types/discovery';

	let data = $state<DiscoveryResponse | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Create Load form state
	let creatingFor: DiscoveryItem | null = $state(null);
	let createName = $state('');
	let createCategory = $state('other');
	let createPowerSource = $state('AC (wall outlet)');
	let createAreaId: number | undefined = $state(undefined);
	let createCircuitId: number | undefined = $state(undefined);
	let createSaving = $state(false);

	// Link to existing state
	let linkingFor: DiscoveryItem | null = $state(null);
	let linkSearch = $state('');
	let linkSaving = $state(false);

	const categoryOptions = [
		{ id: 'networking', label: '🌐 Networking' },
		{ id: 'computing', label: '🖥️ Computing' },
		{ id: 'iot-hub', label: '🔗 IoT Hub' },
		{ id: 'media', label: '📺 Media' },
		{ id: 'camera', label: '📹 Camera' },
		{ id: 'climate', label: '🌡️ Climate' },
		{ id: 'lighting', label: '💡 Lighting' },
		{ id: 'sensor', label: '📡 Sensor' },
		{ id: 'appliance', label: '🔌 Appliance' },
		{ id: 'power', label: '⚡ Power' },
		{ id: 'security', label: '🛡️ Security' },
		{ id: 'other', label: '📦 Other' }
	];

	const powerSourceOptions = ['AC (wall outlet)', 'POE', 'POE+', 'Battery', 'USB', 'DC'];

	let filteredLoads = $derived(
		(data?.availableLoads || []).filter((l: { id: number; title: string; areaName?: string }) =>
			!linkSearch || l.title.toLowerCase().includes(linkSearch.toLowerCase())
		).slice(0, 20)
	);

	async function fetchDiscovery() {
		try {
			const resp = await fetch('/api/devices/discovery');
			if (!resp.ok) throw new Error('Failed to load discovery data');
			data = await resp.json();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	}

	async function handleLink(item: DiscoveryItem, loadId: number) {
		linkSaving = true;
		try {
			const resp = await fetch('/api/devices/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'link',
					discoveryId: item.id,
					source: item.source,
					externalId: item.externalId,
					loadId
				})
			});
			if (!resp.ok) throw new Error('Link failed');
			toast.success(`Linked "${item.name}" to existing load`);
			linkingFor = null;
			await fetchDiscovery();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Link failed');
		} finally {
			linkSaving = false;
		}
	}

	async function handleAcceptSuggestion(item: DiscoveryItem) {
		if (!item.suggestion) return;
		await handleLink(item, item.suggestion.loadId);
	}

	async function handleCreate() {
		if (!creatingFor) return;
		createSaving = true;
		try {
			const resp = await fetch('/api/devices/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'create',
					discoveryId: creatingFor.id,
					source: creatingFor.source,
					externalId: creatingFor.externalId,
					name: createName,
					deviceCategory: createCategory,
					powerSource: createPowerSource,
					areaId: createAreaId || undefined,
					circuitId: createCircuitId || undefined,
					upstreamMac: (creatingFor.metadata as Record<string, unknown>)?.upstream_mac as string || undefined
				})
			});
			if (!resp.ok) throw new Error('Create failed');
			toast.success(`Created load "${createName}"`);
			creatingFor = null;
			await fetchDiscovery();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Create failed');
		} finally {
			createSaving = false;
		}
	}

	async function handleIgnore(item: DiscoveryItem) {
		try {
			const resp = await fetch('/api/devices/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'ignore', discoveryId: item.id })
			});
			if (!resp.ok) throw new Error('Ignore failed');
			toast.success(`Ignored "${item.name}"`);
			await fetchDiscovery();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Ignore failed');
		}
	}

	async function handleIgnoreAll() {
		if (!data) return;
		const ids = data.items.map((i: DiscoveryItem) => i.id);
		try {
			const resp = await fetch('/api/devices/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'ignore-all', discoveryIds: ids })
			});
			if (!resp.ok) throw new Error('Ignore all failed');
			toast.success(`Ignored ${ids.length} devices`);
			await fetchDiscovery();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Ignore all failed');
		}
	}

	function openCreateForm(item: DiscoveryItem) {
		creatingFor = item;
		createName = item.name;
		createCategory = item.inferredCategory || 'other';
		createPowerSource = item.powerSource || 'AC (wall outlet)';
		createAreaId = item.inferredAreaId;
		createCircuitId = undefined;
		linkingFor = null;
	}

	function openLinkForm(item: DiscoveryItem) {
		linkingFor = item;
		linkSearch = '';
		creatingFor = null;
	}

	onMount(fetchDiscovery);
</script>

<div class="space-y-(--spacing-section)">
	<!-- Header -->
	<div class="flex items-center gap-2">
		<a href="/devices" class="text-fg-faint hover:text-fg-secondary transition-colors">
			<Icon icon="mdi:arrow-left" width={20} />
		</a>
		<Icon icon="mdi:radar" width={22} class="text-indigo-400" />
		<h1 class="text-xl font-bold text-fg">Device Discovery</h1>
		{#if data && !loading}
			<button
				onclick={handleIgnoreAll}
				class="ml-auto text-caption text-fg-faint hover:text-fg-secondary transition-colors"
			>Ignore All</button>
		{/if}
	</div>

	<!-- Source status -->
	{#if data}
		<div class="flex gap-3 text-caption text-fg-faint">
			<span class="flex items-center gap-1.5">
				<span class="w-1.5 h-1.5 rounded-full {data.sources.unifi ? 'bg-indigo-400' : 'bg-slate-600'}"></span>
				UniFi {data.sources.unifi ? '✓' : '✗'}
			</span>
			<span class="flex items-center gap-1.5">
				<span class="w-1.5 h-1.5 rounded-full {data.sources.ha ? 'bg-sky-400' : 'bg-slate-600'}"></span>
				Home Assistant {data.sources.ha ? '✓' : '✗'}
			</span>
		</div>

		<!-- Summary stats -->
		<div class="grid grid-cols-3 gap-2">
			<div class="rounded-lg bg-surface-secondary border border-border-subtle p-3 text-center">
				<div class="text-lg font-bold text-amber-400">{data.summary.suggested}</div>
				<div class="text-[10px] text-fg-faint">Suggested</div>
			</div>
			<div class="rounded-lg bg-surface-secondary border border-border-subtle p-3 text-center">
				<div class="text-lg font-bold text-slate-300">{data.summary.unmatched}</div>
				<div class="text-[10px] text-fg-faint">Unmatched</div>
			</div>
			<div class="rounded-lg bg-surface-secondary border border-border-subtle p-3 text-center">
				<div class="text-lg font-bold text-fg-faint">{data.summary.ignored}</div>
				<div class="text-[10px] text-fg-faint">Ignored</div>
			</div>
		</div>
	{/if}

	<!-- Loading -->
	{#if loading}
		<div class="space-y-3">
			{#each Array(4) as _}
				<div class="rounded-lg bg-surface-secondary border border-border-subtle p-4 animate-pulse">
					<div class="flex items-center gap-3">
						<div class="w-9 h-9 rounded-md bg-slate-700"></div>
						<div class="flex-1 space-y-2">
							<div class="h-3 w-40 bg-slate-700 rounded"></div>
							<div class="h-2 w-56 bg-slate-700/60 rounded"></div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else if error}
		<div class="text-center py-8">
			<Icon icon="mdi:alert-circle" width={32} class="text-red-400 mx-auto mb-2" />
			<p class="text-sm text-red-300">{error}</p>
			<button onclick={fetchDiscovery} class="mt-3 text-caption text-accent-fg hover:underline">Retry</button>
		</div>
	{:else if data && data.items.length === 0}
		<div class="text-center py-12">
			<Icon icon="mdi:check-circle" width={40} class="text-emerald-400 mx-auto mb-3" />
			<p class="text-body text-fg-secondary">All devices matched!</p>
			<p class="text-caption text-fg-faint mt-1">No unmatched devices found in UniFi or Home Assistant.</p>
			<a href="/devices" class="mt-4 inline-block text-caption text-accent-fg hover:underline">← Back to Devices</a>
		</div>
	{:else if data}
		<!-- Discovery items -->
		<div class="space-y-3">
			{#each data.items as item (item.id)}
				<div class="rounded-lg bg-surface-secondary border border-border-subtle p-4 space-y-3">
					<!-- Item header -->
					<div class="flex items-start gap-3">
						<div class="w-9 h-9 rounded-md bg-slate-700/50 flex items-center justify-center shrink-0">
							<Icon
								icon={item.source === 'unifi' ? 'mdi:lan' : 'mdi:home-assistant'}
								width={18}
								class={item.source === 'unifi' ? 'text-indigo-400' : 'text-sky-400'}
							/>
						</div>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="text-body font-medium text-fg truncate">{item.name}</span>
								<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium
									{item.source === 'unifi' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-sky-500/15 text-sky-300'}">
									{item.source === 'unifi' ? 'UniFi' : 'HA'}
								</span>
							</div>
							<p class="text-caption text-fg-faint mt-0.5">
								{[item.manufacturer, item.model, item.ip].filter(Boolean).join(' · ')}
							</p>
							{#if item.inferredAreaName}
								<p class="text-caption text-fg-faint">Area: {item.inferredAreaName}</p>
							{/if}
						</div>
					</div>

					<!-- Suggestion -->
					{#if item.suggestion}
						<div class="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-2.5">
							<div class="flex items-center gap-1.5 mb-1.5">
								<Icon icon="mdi:lightbulb-on" width={14} class="text-emerald-400" />
								<span class="text-caption text-emerald-300 font-medium">
									{Math.round(item.suggestion.confidence * 100)}% match: "{item.suggestion.loadName}"
								</span>
							</div>
							<p class="text-[10px] text-emerald-200/70 mb-2">{item.suggestion.reason}</p>
							<div class="flex gap-2">
								<button
									onclick={() => handleAcceptSuggestion(item)}
									class="text-caption font-medium bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 px-3 py-1.5 rounded-md transition-colors"
								>
									<Icon icon="mdi:link" width={12} class="inline -mt-0.5 mr-1" />Link
								</button>
								<button
									onclick={() => openLinkForm(item)}
									class="text-caption text-fg-faint hover:text-fg-secondary px-2 py-1.5 transition-colors"
								>Wrong match</button>
							</div>
						</div>
					{/if}

					<!-- Actions (when no suggestion) -->
					{#if !item.suggestion}
						<div class="flex gap-2">
							<button
								onclick={() => openCreateForm(item)}
								class="text-caption font-medium bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 px-3 py-1.5 rounded-md transition-colors"
							>
								<Icon icon="mdi:plus" width={12} class="inline -mt-0.5 mr-0.5" />Create Load
							</button>
							<button
								onclick={() => openLinkForm(item)}
								class="text-caption font-medium bg-slate-700/50 text-fg-secondary hover:bg-slate-700/80 px-3 py-1.5 rounded-md transition-colors"
							>
								<Icon icon="mdi:link-variant" width={12} class="inline -mt-0.5 mr-0.5" />Match to…
							</button>
							<button
								onclick={() => handleIgnore(item)}
								class="text-caption text-fg-faint hover:text-fg-secondary px-2 py-1.5 transition-colors"
							>Ignore</button>
						</div>
					{/if}

					<!-- Inline: Link to existing form -->
					{#if linkingFor?.id === item.id}
						<div class="rounded-md bg-slate-800/80 border border-slate-600/30 p-3 space-y-2">
							<div class="flex items-center justify-between">
								<span class="text-caption font-medium text-fg-secondary">Link to existing load</span>
								<button onclick={() => { linkingFor = null; }} class="text-fg-faint hover:text-fg-secondary">
									<Icon icon="mdi:close" width={14} />
								</button>
							</div>
							<input
								type="text"
								bind:value={linkSearch}
								placeholder="Search loads…"
								class="w-full bg-slate-900 border border-slate-600/50 rounded-md px-3 py-1.5 text-caption text-fg focus:border-accent focus:outline-none"
							/>
							<div class="max-h-36 overflow-y-auto space-y-0.5">
								{#each filteredLoads as load (load.id)}
									<button
										onclick={() => handleLink(item, load.id)}
										disabled={linkSaving}
										class="w-full text-left px-2 py-1.5 rounded text-caption text-fg-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
									>
										{load.title}
										{#if load.areaName}
											<span class="text-fg-faint"> · {load.areaName}</span>
										{/if}
									</button>
								{/each}
								{#if filteredLoads.length === 0}
									<p class="text-caption text-fg-faint py-2 text-center">No matching loads</p>
								{/if}
							</div>
							<div class="border-t border-slate-600/30 pt-2 mt-1">
								<button
									onclick={() => openCreateForm(item)}
									class="w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded text-caption font-medium text-indigo-300 hover:bg-indigo-500/10 transition-colors"
								>
									<Icon icon="mdi:plus" width={14} />
									Create new load instead
								</button>
							</div>
						</div>
					{/if}

					<!-- Inline: Create Load form -->
					{#if creatingFor?.id === item.id}
						<div class="rounded-md bg-slate-800/80 border border-slate-600/30 p-3 space-y-3">
							<div class="flex items-center justify-between">
								<span class="text-caption font-medium text-fg-secondary">Create Load from Discovery</span>
								<button onclick={() => { creatingFor = null; }} class="text-fg-faint hover:text-fg-secondary">
									<Icon icon="mdi:close" width={14} />
								</button>
							</div>

							<!-- Source info -->
							<div class="rounded-md bg-slate-900/60 border border-slate-700/30 p-2 flex items-center gap-2">
								<Icon
									icon={item.source === 'unifi' ? 'mdi:lan' : 'mdi:home-assistant'}
									width={16}
									class={item.source === 'unifi' ? 'text-indigo-400' : 'text-sky-400'}
								/>
								<span class="text-caption text-fg-faint">
									From {item.source === 'unifi' ? 'UniFi' : 'Home Assistant'}
									{#if item.metadata?.area_name} · Area: {item.metadata.area_name}{/if}
									{#if item.manufacturer} · {item.manufacturer}{/if}
								</span>
							</div>

							<!-- Form -->
							<div class="space-y-2">
								<div>
									<label class="text-[10px] text-fg-faint font-medium block mb-1">Name</label>
									<input
										type="text"
										bind:value={createName}
										class="w-full bg-slate-900 border border-slate-600/50 rounded-md px-3 py-1.5 text-caption text-fg focus:border-accent focus:outline-none"
									/>
								</div>
								<div class="grid grid-cols-2 gap-2">
									<div>
										<label class="text-[10px] text-fg-faint font-medium block mb-1">Category</label>
										<select bind:value={createCategory} class="w-full bg-slate-900 border border-slate-600/50 rounded-md px-2 py-1.5 text-caption text-fg">
											{#each categoryOptions as opt}
												<option value={opt.id}>{opt.label}</option>
											{/each}
										</select>
									</div>
									<div>
										<label class="text-[10px] text-fg-faint font-medium block mb-1">Room</label>
										<select bind:value={createAreaId} class="w-full bg-slate-900 border border-slate-600/50 rounded-md px-2 py-1.5 text-caption text-fg">
											<option value={undefined}>Assign later…</option>
											{#each data?.areas || [] as area}
												<option value={area.id}>{area.name}</option>
											{/each}
										</select>
									</div>
								</div>
								<div>
									<label class="text-[10px] text-fg-faint font-medium block mb-1">Power Source</label>
									<select bind:value={createPowerSource} class="w-full bg-slate-900 border border-slate-600/50 rounded-md px-2 py-1.5 text-caption text-fg">
										{#each powerSourceOptions as opt}
											<option>{opt}</option>
										{/each}
									</select>
								</div>
							</div>

							<!-- Auto-link info -->
							<div class="rounded-md bg-indigo-500/10 border border-indigo-500/20 p-2">
								<p class="text-[10px] text-indigo-300">
									<Icon icon="mdi:information" width={11} class="inline -mt-0.5 mr-0.5" />
									Will automatically link {item.source === 'unifi' ? `MAC ${item.externalId}` : `HA device ${item.externalId.slice(0, 12)}…`} to the new Load.
								</p>
							</div>

							<div class="flex gap-2">
								<button
									onclick={handleCreate}
									disabled={createSaving || !createName.trim()}
									class="flex-1 text-caption font-medium bg-indigo-500 text-white hover:bg-indigo-600 rounded-md py-2 transition-colors disabled:opacity-50"
								>
									{createSaving ? 'Creating…' : 'Create Load'}
								</button>
								<button
									onclick={() => { creatingFor = null; }}
									class="text-caption text-fg-faint hover:text-fg-secondary px-4 py-2"
								>Cancel</button>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
