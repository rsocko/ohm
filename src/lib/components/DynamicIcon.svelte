<script lang="ts">
	import Icon from '@iconify/svelte';

	interface Props {
		icon: string;
		size?: number;
		class?: string;
	}

	let { icon, size = 20, class: className = '' }: Props = $props();

	// Determine if this is an iconify reference (contains ':') or plain emoji/text
	const isIconify = $derived(icon.includes(':'));
</script>

{#if isIconify}
	<Icon {icon} width={size} height={size} class={className} />
{:else}
	<span class={className} style="font-size: {size}px; line-height: 1">{icon}</span>
{/if}
