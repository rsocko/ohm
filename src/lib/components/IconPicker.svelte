<script lang="ts">
	import Icon from '@iconify/svelte';

	interface Props {
		value?: string;
		onselect: (icon: string) => void;
		onclose: () => void;
	}

	let { value = '', onselect, onclose }: Props = $props();

	let query = $state('');
	let activeLib = $state<'all' | 'mdi' | 'ph' | 'lucide'>('all');
	let results = $state<string[]>([]);
	let loading = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout>;

	const libs = [
		{ id: 'all' as const, label: 'All' },
		{ id: 'mdi' as const, label: 'MDI' },
		{ id: 'ph' as const, label: 'Phosphor' },
		{ id: 'lucide' as const, label: 'Lucide' }
	];

	// Curated suggestions when no search query
	const suggestions = [
		'mdi:home', 'mdi:lightbulb', 'mdi:bed', 'mdi:sofa', 'mdi:stove',
		'mdi:shower', 'mdi:desk', 'mdi:television', 'mdi:fan', 'mdi:lamp',
		'mdi:fridge', 'mdi:washing-machine', 'mdi:garage', 'mdi:pool',
		'mdi:grill', 'mdi:tree', 'mdi:ceiling-light', 'mdi:floor-plan',
		'ph:bathtub-bold', 'ph:garage-bold', 'ph:door-open-bold',
		'lucide:lamp-floor', 'lucide:refrigerator', 'lucide:monitor'
	];

	async function search(q: string, lib: string) {
		if (!q.trim()) {
			results = suggestions;
			return;
		}
		loading = true;
		try {
			const prefix = lib === 'all' ? 'mdi,ph,lucide' : lib;
			const resp = await fetch(
				`https://api.iconify.design/search?query=${encodeURIComponent(q)}&prefixes=${prefix}&limit=60`
			);
			if (resp.ok) {
				const data = await resp.json();
				results = data.icons || [];
			} else {
				results = [];
			}
		} catch {
			results = [];
		} finally {
			loading = false;
		}
	}

	function handleInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => search(query, activeLib), 300);
	}

	function switchLib(lib: typeof activeLib) {
		activeLib = lib;
		search(query, lib);
	}

	// Initial load
	$effect(() => {
		results = suggestions;
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
	role="dialog"
	aria-modal="true"
	onkeydown={(e) => { if (e.key === 'Escape') onclose(); }}
>
	<!-- Backdrop -->
	<button
		class="absolute inset-0 bg-black/60 backdrop-blur-sm"
		onclick={onclose}
		aria-label="Close"
		tabindex="-1"
	></button>

	<!-- Panel -->
	<div class="relative w-full max-w-md max-h-[80vh] bg-slate-800 border border-slate-700 rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden shadow-2xl">
		<!-- Header -->
		<div class="p-4 border-b border-slate-700/60 space-y-3">
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-semibold text-white">Choose Icon</h3>
				<button onclick={onclose} class="text-slate-400 hover:text-white p-1 rounded-md">
					<Icon icon="mdi:close" width={18} />
				</button>
			</div>

			<!-- Search -->
			<div class="relative">
				<Icon icon="mdi:magnify" width={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
				<input
					type="text"
					bind:value={query}
					oninput={handleInput}
					placeholder="Search icons…"
					class="w-full bg-slate-900/60 border border-slate-600/50 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 transition-border-color"
				/>
			</div>

			<!-- Library tabs -->
			<div class="flex gap-1.5">
				{#each libs as lib}
					<button
						onclick={() => switchLib(lib.id)}
						class="px-2.5 py-1 rounded-md text-xs font-medium transition-background-color,color {activeLib === lib.id ? 'bg-blue-600 text-white' : 'bg-slate-700/60 text-slate-400 hover:text-white'}"
					>
						{lib.label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Current selection -->
		{#if value}
			<div class="px-4 py-2 border-b border-slate-700/40 flex items-center gap-2 text-xs text-slate-400">
				<Icon icon={value} width={16} class="text-blue-400" />
				<span>Current: <code class="text-slate-300">{value}</code></span>
			</div>
		{/if}

		<!-- Results grid -->
		<div class="flex-1 overflow-y-auto p-3">
			{#if loading}
				<div class="flex items-center justify-center py-8 text-slate-500 text-sm">
					<Icon icon="mdi:loading" width={20} class="animate-spin mr-2" />
					Searching…
				</div>
			{:else if results.length === 0}
				<p class="text-center text-slate-500 text-sm py-8">No icons found</p>
			{:else}
				<div class="grid grid-cols-6 gap-1">
					{#each results as icon}
						{@const selected = icon === value}
						<button
							onclick={() => onselect(icon)}
							title={icon}
							class="aspect-square flex items-center justify-center rounded-lg transition-background-color,transform hover:bg-slate-700/60 active:scale-[0.92] {selected ? 'bg-blue-600/20 ring-1 ring-blue-500' : ''}"
						>
							<Icon {icon} width={22} class="{selected ? 'text-blue-400' : 'text-slate-300'}" />
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Footer hint -->
		<div class="px-4 py-2.5 border-t border-slate-700/40 text-xs text-slate-500">
			{results.length} icons · Tap to select · Sources: MDI, Phosphor, Lucide
		</div>
	</div>
</div>
