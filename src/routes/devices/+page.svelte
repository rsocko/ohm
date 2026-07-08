<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import LoadEditForm from '$lib/components/LoadEditForm.svelte';
	import type { UnifiedDevice } from '../api/devices/unified/+server';
	import { homeContext, getHomeAreaIds } from '$lib/stores/home-context.svelte';

	let allDevices: UnifiedDevice[] = $state([]);
	let devices = $derived.by(() => {
		if (!homeContext.selectedHomeId) return allDevices;
		const areaIds = getHomeAreaIds();
		// Show devices that belong to this home's areas OR are unassigned
		return allDevices.filter(d => !d.areaId || areaIds.has(d.areaId));
	});
	let meta = $state<{ totalLoads: number; unifiConnected: boolean; haConnected: boolean; discoveryCount: number } | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let activeCategory = $state('all');
	let searchQuery = $state('');
	let selectedDevice: UnifiedDevice | null = $state(null);
	let editingDeviceId: string | null = $state(null);

	const categories = [
		{ id: 'all', label: 'All' },
		{ id: 'networking', label: 'Networking', icon: 'mdi:router-wireless', color: 'text-fuchsia-400' },
		{ id: 'computing', label: 'Computing', icon: 'mdi:desktop-tower', color: 'text-slate-400' },
		{ id: 'iot-hub', label: 'IoT', icon: 'mdi:hub', color: 'text-teal-400' },
		{ id: 'media', label: 'Media', icon: 'mdi:television', color: 'text-indigo-400' },
		{ id: 'camera', label: 'Cameras', icon: 'mdi:cctv', color: 'text-red-400' },
		{ id: 'climate', label: 'Climate', icon: 'mdi:thermostat', color: 'text-green-400' },
		{ id: 'lighting', label: 'Lighting', icon: 'mdi:lightbulb', color: 'text-yellow-400' },
		{ id: 'appliance', label: 'Appliances', icon: 'mdi:washing-machine', color: 'text-orange-400' },
		{ id: 'power', label: 'Power', icon: 'mdi:flash', color: 'text-amber-400' },
		{ id: 'other', label: 'Other', icon: 'mdi:devices', color: 'text-slate-400' }
	];

	const categoryMeta: Record<string, { icon: string; bg: string; color: string }> = {
		networking: { icon: 'mdi:router-wireless', bg: 'bg-fuchsia-500/20', color: 'text-fuchsia-400' },
		computing: { icon: 'mdi:desktop-tower', bg: 'bg-slate-500/20', color: 'text-slate-300' },
		'iot-hub': { icon: 'mdi:hub', bg: 'bg-teal-500/20', color: 'text-teal-400' },
		media: { icon: 'mdi:television', bg: 'bg-indigo-500/20', color: 'text-indigo-400' },
		camera: { icon: 'mdi:cctv', bg: 'bg-red-500/20', color: 'text-red-400' },
		climate: { icon: 'mdi:thermostat', bg: 'bg-green-500/20', color: 'text-green-400' },
		lighting: { icon: 'mdi:lightbulb', bg: 'bg-yellow-500/20', color: 'text-yellow-400' },
		appliance: { icon: 'mdi:washing-machine', bg: 'bg-orange-500/20', color: 'text-orange-400' },
		power: { icon: 'mdi:flash', bg: 'bg-amber-500/20', color: 'text-amber-400' },
		sensor: { icon: 'mdi:motion-sensor', bg: 'bg-cyan-500/20', color: 'text-cyan-400' },
		security: { icon: 'mdi:shield-home', bg: 'bg-red-500/20', color: 'text-red-400' },
		other: { icon: 'mdi:devices', bg: 'bg-slate-500/20', color: 'text-slate-400' }
	};

	let filteredDevices = $derived.by(() => {
		let result = activeCategory === 'all'
			? devices
			: devices.filter(d => d.deviceCategory === activeCategory);
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(d =>
				d.name.toLowerCase().includes(q) ||
				(d.areaName && d.areaName.toLowerCase().includes(q)) ||
				(d.circuitName && d.circuitName.toLowerCase().includes(q)) ||
				(d.network?.ip && d.network.ip.includes(q)) ||
				(d.network?.mac && d.network.mac.toLowerCase().includes(q))
			);
		}
		return result;
	});

	function formatUptime(seconds: number): string {
		const days = Math.floor(seconds / 86400);
		const hours = Math.floor((seconds % 86400) / 3600);
		if (days > 0) return `${days}d ${hours}h`;
		const mins = Math.floor((seconds % 3600) / 60);
		return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
	}

	let categoryCounts = $derived(() => {
		const counts: Record<string, number> = { all: devices.length };
		for (const d of devices) {
			counts[d.deviceCategory] = (counts[d.deviceCategory] || 0) + 1;
		}
		return counts;
	});

	async function fetchDevices() {
		try {
			const resp = await fetch('/api/devices/unified');
			if (!resp.ok) throw new Error('Failed to load devices');
			const data = await resp.json();
			allDevices = data.devices;
			meta = data.meta;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	}

	onMount(fetchDevices);
</script>

<div class="space-y-(--spacing-section)">
	<!-- Header -->
	<div class="flex items-center gap-2">
		<Icon icon="mdi:devices" width={22} class="text-teal-400" />
		<h1 class="text-xl font-bold text-white">Devices</h1>
		{#if meta?.discoveryCount}
			<a href="/devices/discovery" class="flex items-center gap-1.5 text-caption font-medium bg-accent-subtle text-accent-fg hover:bg-accent-subtle/60 px-2.5 py-1 rounded-pill transition-colors">
				<Icon icon="mdi:radar" width={14} />
				<span>{meta.discoveryCount} new</span>
			</a>
		{/if}
	</div>

	<!-- Integration status -->
	{#if meta}
		<div class="flex gap-3 text-caption">
			<span class="flex items-center gap-1.5 {meta.unifiConnected ? 'text-source-unifi' : 'text-fg-faint'}">
				<span class="w-1.5 h-1.5 rounded-full {meta.unifiConnected ? 'bg-source-unifi' : 'bg-danger/60'}"></span>
				UniFi {meta.unifiConnected ? '✓' : '✗'}
			</span>
			<span class="flex items-center gap-1.5 {meta.haConnected ? 'text-source-ha' : 'text-fg-faint'}">
				<span class="w-1.5 h-1.5 rounded-full {meta.haConnected ? 'bg-source-ha' : 'bg-danger/60'}"></span>
				HA {meta.haConnected ? '✓' : '✗'}
			</span>
			{#if !meta.unifiConnected || !meta.haConnected}
				<span class="text-fg-faint text-[10px] ml-auto">Some enrichments unavailable</span>
			{/if}
		</div>
	{/if}

	<!-- Search -->
	<div class="relative">
		<Icon icon="mdi:magnify" width={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Search devices…"
			class="w-full bg-surface-secondary border border-border-subtle rounded-lg pl-9 pr-3 py-2 text-caption text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none transition-colors"
		/>
		{#if searchQuery}
			<button
				onclick={() => searchQuery = ''}
				class="absolute right-3 top-1/2 -translate-y-1/2 text-fg-faint hover:text-fg-secondary"
			>
				<Icon icon="mdi:close" width={14} />
			</button>
		{/if}
	</div>

	<!-- Category filter pills -->
	<div class="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
		{#each categories as cat}
			{@const count = categoryCounts()[cat.id] || 0}
			{#if cat.id === 'all' || count > 0}
				<button
					onclick={() => activeCategory = cat.id}
					class="shrink-0 text-caption font-medium px-2.5 py-1 rounded-pill transition-colors whitespace-nowrap
						{activeCategory === cat.id
							? 'bg-accent-subtle text-accent-fg'
							: 'text-fg-muted hover:text-fg-secondary hover:bg-surface-hover'}"
				>
					{cat.label}{count > 0 ? ` (${count})` : ''}
				</button>
			{/if}
		{/each}
	</div>

	<!-- Device list -->
	{#if loading}
		<div class="space-y-2">
			{#each Array(6) as _}
				<div class="flex items-center gap-2.5 p-2 rounded-lg bg-slate-800/30 animate-pulse">
					<div class="w-7 h-7 rounded-md bg-slate-700"></div>
					<div class="flex-1 space-y-1.5">
						<div class="h-3 w-32 bg-slate-700 rounded"></div>
						<div class="h-2 w-48 bg-slate-700/60 rounded"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if error}
		<div class="text-center py-8">
			<Icon icon="mdi:alert-circle" width={32} class="text-red-400 mx-auto mb-2" />
			<p class="text-sm text-red-300">{error}</p>
		</div>
	{:else if filteredDevices.length === 0}
		<div class="text-center py-8">
			<Icon icon="mdi:devices" width={32} class="text-slate-500 mx-auto mb-2" />
			<p class="text-sm text-slate-400">No devices found</p>
		</div>
	{:else}
		<div class="space-y-1">
			{#each filteredDevices as device (device.id)}
				{@const cm = categoryMeta[device.deviceCategory] || categoryMeta.other}
				{@const isOnline = device.network?.isOnline}
				{@const isExpanded = selectedDevice?.id === device.id}
				<div class="rounded-md transition-colors {isExpanded ? 'bg-surface-active ring-1 ring-accent/30' : ''}">
					<button
						onclick={() => { selectedDevice = isExpanded ? null : device; }}
						class="w-full flex items-center gap-3 p-3 rounded-md hover:bg-surface-hover cursor-pointer transition-colors text-left
							{isOnline === false ? 'opacity-50' : ''}"
					>
						<div class="w-9 h-9 rounded-md {cm.bg} flex items-center justify-center shrink-0">
								<Icon icon={device.icon || cm.icon} width={18} class={cm.color} />
						</div>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-1.5">
								<span class="text-body font-medium text-fg truncate">{device.name}</span>
								{#if device.network}
									<span class="w-[6px] h-[6px] rounded-full shrink-0 {device.network.isOnline ? 'bg-success shadow-glow-online' : 'bg-danger shadow-glow-offline'}"></span>
								{/if}
							</div>
							<span class="text-caption text-fg-faint block truncate">
								{[
									device.deviceCategory !== 'other' ? device.deviceCategory.replace('-', ' ') : '',
									device.areaName || '',
									device.circuitName ? `Circuit ${device.circuitName}` : ''
								].filter(Boolean).join(' · ') || device.network?.ip || ''}
							</span>
						</div>
						<!-- Source dots -->
						<div class="flex gap-1 shrink-0">
							{#if device.sources.includes('nocodb')}
								<span class="w-2 h-2 rounded-full bg-source-nocodb" title="Electrical Catalog"></span>
							{/if}
							{#if device.sources.includes('unifi')}
								<span class="w-2 h-2 rounded-full bg-source-unifi" title="UniFi"></span>
							{/if}
							{#if device.sources.includes('ha')}
								<span class="w-2 h-2 rounded-full bg-source-ha" title="Home Assistant"></span>
							{/if}
						</div>
						<Icon icon={isExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} width={16} class="text-fg-faint shrink-0" />
					</button>

					<!-- Inline expanded detail (matches mockup card design) -->
					{#if isExpanded}
							<div class="px-3 pb-3 pt-2 space-y-2.5">
								<!-- Source badges (colored pills with icons) -->
								<div class="flex gap-1.5 flex-wrap">
									{#if device.sources.includes('nocodb')}
										<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-300">
											<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Electrical Catalog
										</span>
									{/if}
									{#if device.sources.includes('unifi')}
										<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/15 text-indigo-300">
											<span class="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>UniFi
										</span>
								{/if}
									{#if device.sources.includes('ha')}
										<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-500/15 text-sky-300">
											<span class="w-1.5 h-1.5 rounded-full bg-sky-400"></span>Home Assistant
										</span>
									{/if}
								</div>

								<!-- Electrical section (from catalog) -->
								{#if device.circuitName || device.panelName || device.breakerAmps || device.powerSource}
									<div class="rounded-lg bg-slate-900/80 border border-slate-700/30 p-2.5">
										<div class="flex items-center gap-1.5 mb-2">
											<Icon icon="mdi:flash" width={13} class="text-emerald-400" />
											<span class="text-[10px] font-semibold text-emerald-300 uppercase tracking-wide">Electrical</span>
										</div>
										<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
											{#if device.circuitName}
												<div><span class="text-slate-500">Circuit:</span> <span class="text-slate-200">{device.circuitName}</span></div>
										{/if}
											{#if device.panelName}
												<div><span class="text-slate-500">Panel:</span> <span class="text-slate-200">{device.panelName}</span></div>
										{/if}
											{#if device.breakerAmps}
												<div><span class="text-slate-500">Breaker:</span> <span class="text-slate-200">{device.breakerAmps}A</span></div>
											{/if}
											{#if device.powerSource}
												<div><span class="text-slate-500">Power:</span> <span class="text-slate-200">{device.powerSource}</span></div>
											{/if}
										</div>
									</div>
								{:else}
									<!-- Minimal info when no circuit link exists -->
									<div class="rounded-lg bg-slate-900/80 border border-slate-700/30 p-2.5">
										<div class="flex items-center gap-1.5 mb-2">
											<Icon icon="mdi:information-outline" width={13} class="text-slate-400" />
											<span class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Details</span>
										</div>
										<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
											<div><span class="text-slate-500">Category:</span> <span class="text-slate-200 capitalize">{device.deviceCategory.replace('-', ' ')}</span></div>
											{#if device.areaName}
												<div><span class="text-slate-500">Room:</span> <span class="text-slate-200">{device.areaName}</span></div>
											{/if}
										</div>
									</div>
								{/if}

								<!-- Network section (from UniFi) -->
								{#if device.network}
									<div class="rounded-lg bg-slate-900/80 border border-slate-700/30 p-2.5">
										<div class="flex items-center gap-1.5 mb-2">
											<Icon icon="mdi:lan" width={13} class="text-indigo-400" />
											<span class="text-[10px] font-semibold text-indigo-300 uppercase tracking-wide">Network</span>
										</div>
										<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
											{#if device.network.ip}
												<div><span class="text-slate-500">IP:</span> <span class="text-slate-200">{device.network.ip}</span></div>
										{/if}
											<div><span class="text-slate-500">MAC:</span> <span class="text-slate-200 font-mono text-[10px]">{device.network.mac.slice(0, 14)}…</span></div>
											{#if device.network.switchPort}
												<div><span class="text-slate-500">Switch:</span> <span class="text-slate-200">Port {device.network.switchPort.port}</span></div>
											{/if}
											{#if device.network.vlan}
												<div><span class="text-slate-500">VLAN:</span> <span class="text-slate-200">{device.network.vlan}</span></div>
											{/if}
											{#if device.network.uptime}
												<div><span class="text-slate-500">Uptime:</span> <span class="text-slate-200">{formatUptime(device.network.uptime)}</span></div>
											{/if}
											{#if device.network.poePower}
												<div><span class="text-slate-500">Power:</span> <span class="text-slate-200">{device.network.poePower}W (POE)</span></div>
											{/if}
										</div>
									</div>
								{/if}

								<!-- Home Assistant section -->
								{#if device.homeAssistant}
									<div class="rounded-lg bg-slate-900/80 border border-slate-700/30 p-2.5">
										<div class="flex items-center gap-1.5 mb-2">
											<Icon icon="mdi:home-assistant" width={13} class="text-sky-400" />
											<span class="text-[10px] font-semibold text-sky-300 uppercase tracking-wide">Home Assistant</span>
										</div>
										<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
											{#if device.homeAssistant.manufacturer}
												<div><span class="text-slate-500">Model:</span> <span class="text-slate-200">{device.homeAssistant.model || device.homeAssistant.manufacturer}</span></div>
											{/if}
											{#if device.homeAssistant.swVersion}
												<div><span class="text-slate-500">FW:</span> <span class="text-slate-200">{device.homeAssistant.swVersion}</span></div>
											{/if}
											{#if device.homeAssistant.areaName}
												<div><span class="text-slate-500">Area:</span> <span class="text-slate-200">{device.homeAssistant.areaName}</span></div>
											{/if}
											{#if device.homeAssistant.viaDevice}
												<div><span class="text-slate-500">Via:</span> <span class="text-slate-200">{device.homeAssistant.viaDevice}</span></div>
											{/if}
										</div>
									</div>
								{/if}

								<!-- Actions -->
								<div class="flex gap-2 pt-1">
									{#if device.areaId}
											<a href="/rooms?view=floorplan&area={device.areaId}&device={device.id}" class="flex-1 text-[11px] font-medium text-center bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 rounded-lg py-2 transition-colors">
											<Icon icon="mdi:map-marker" width={12} class="inline -mt-0.5 mr-1" />View on Plan
										</a>
									{/if}
									<button
										onclick={() => { editingDeviceId = editingDeviceId === device.id ? null : device.id; }}
										class="flex-1 text-[11px] font-medium text-center bg-slate-700/50 text-slate-300 hover:bg-slate-700/80 rounded-lg py-2 transition-colors"
									>
										<Icon icon="mdi:pencil" width={12} class="inline -mt-0.5 mr-1" />{editingDeviceId === device.id ? 'Close' : 'Edit Load'}
									</button>
								</div>

								<!-- Inline edit form -->
								{#if editingDeviceId === device.id}
									<LoadEditForm
										recordId={Number(device.id)}
										deviceType="load"
										onClose={() => { editingDeviceId = null; }}
										onSaved={() => { fetchDevices(); }}
									/>
								{/if}
							</div>
						{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
