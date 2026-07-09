<script lang="ts">
	/**
	 * Source — displays a citation/reference link with favicon, title, and optional description.
	 * Used when AI references external data or resources.
	 */
	import Icon from '@iconify/svelte';

	interface Props {
		title: string;
		url?: string;
		description?: string;
		icon?: string;
		/** Source type hint for styling */
		type?: 'link' | 'document' | 'database' | 'api';
	}

	let { title, url, description, icon, type = 'link' }: Props = $props();

	function getTypeIcon(t: string): string {
		switch (t) {
			case 'document': return 'mdi:file-document-outline';
			case 'database': return 'mdi:database-outline';
			case 'api': return 'mdi:api';
			default: return 'mdi:link-variant';
		}
	}

	const displayIcon = $derived(icon || getTypeIcon(type));

	function getDomain(u: string): string {
		try {
			return new URL(u).hostname.replace('www.', '');
		} catch {
			return '';
		}
	}
</script>

{#if url}
	<a
		href={url}
		target="_blank"
		rel="noopener noreferrer"
		class="flex items-start gap-2.5 px-3 py-2 rounded-xl border border-slate-600/30 bg-slate-800/50 hover:bg-slate-700/40 hover:border-slate-500/40 transition-colors group"
	>
		<div class="w-6 h-6 rounded-md bg-slate-700/60 flex items-center justify-center shrink-0 mt-0.5">
			<Icon icon={displayIcon} width={13} class="text-indigo-400" />
		</div>
		<div class="flex-1 min-w-0">
			<span class="text-xs font-medium text-slate-200 group-hover:text-white line-clamp-1">{title}</span>
			{#if description}
				<p class="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{description}</p>
			{/if}
			{#if url}
				<span class="text-[10px] text-slate-500 mt-0.5 block">{getDomain(url)}</span>
			{/if}
		</div>
		<Icon icon="mdi:open-in-new" width={12} class="text-slate-500 group-hover:text-slate-300 shrink-0 mt-1" />
	</a>
{:else}
	<div class="flex items-start gap-2.5 px-3 py-2 rounded-xl border border-slate-600/30 bg-slate-800/50">
		<div class="w-6 h-6 rounded-md bg-slate-700/60 flex items-center justify-center shrink-0 mt-0.5">
			<Icon icon={displayIcon} width={13} class="text-indigo-400" />
		</div>
		<div class="flex-1 min-w-0">
			<span class="text-xs font-medium text-slate-200 line-clamp-1">{title}</span>
			{#if description}
				<p class="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{description}</p>
			{/if}
		</div>
	</div>
{/if}
