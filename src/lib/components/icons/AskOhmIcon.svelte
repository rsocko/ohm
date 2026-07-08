<script lang="ts">
	import Icon from '@iconify/svelte';

	/** Pixel size of the Omega glyph; the sparkle badge scales with it. */
	let { size = 22, class: className = '' }: { size?: number; class?: string } = $props();
</script>

<!-- Ω brand glyph with an AI "sparkle" badge, used to represent the Ask Ohm assistant -->
<span
	class="relative inline-flex items-center justify-center shrink-0 {className}"
	style="width: {size}px; height: {size}px;"
>
	<span
		class="font-bold leading-none text-accent"
		style="font-size: {size * 0.92}px;"
	>&Omega;</span>
	<span
		class="absolute -top-0.5 -right-1 flex items-center justify-center rounded-full bg-surface-base"
		style="width: {size * 0.52}px; height: {size * 0.52}px;"
	>
		<Icon icon="mdi:creation" width={size * 0.4} class="text-[#22D3EE]" />
	</span>
</span>
