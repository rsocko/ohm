<script lang="ts">
	/**
	 * ChatMessageList — auto-scrolling message container with fade edges
	 * and scroll-to-bottom button.
	 */
	import type { Snippet } from 'svelte';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';

	interface Props {
		children: Snippet;
		/** Reactive trigger to scroll (e.g. pass messages.length) */
		scrollTrigger?: number;
	}

	let { children, scrollTrigger = 0 }: Props = $props();

	let container: HTMLElement | undefined = $state(undefined);
	let showScrollButton = $state(false);

	function scrollToBottom(smooth = true) {
		if (!container) return;
		container.scrollTo({
			top: container.scrollHeight,
			behavior: smooth ? 'smooth' : 'instant'
		});
	}

	function handleScroll() {
		if (!container) return;
		const { scrollTop, scrollHeight, clientHeight } = container;
		showScrollButton = scrollHeight - scrollTop - clientHeight > 100;
	}

	$effect(() => {
		void scrollTrigger;
		setTimeout(() => scrollToBottom(true), 50);
	});

	onMount(() => {
		scrollToBottom(false);
	});
</script>

<div class="relative flex-1 min-h-0">
	<!-- Fade overlays -->
	<div class="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-slate-800 to-transparent z-10 pointer-events-none"></div>
	<div class="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-slate-800 to-transparent z-10 pointer-events-none"></div>

	<!-- Scroll container -->
	<div
		bind:this={container}
		onscroll={handleScroll}
		class="h-full overflow-y-auto px-4 py-3 space-y-3 scroll-smooth"
	>
		{@render children()}
	</div>

	<!-- Scroll to bottom button -->
	{#if showScrollButton}
		<button
			onclick={() => scrollToBottom(true)}
			class="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 p-2 rounded-full bg-slate-700 border border-slate-600 shadow-lg text-slate-300 hover:text-white hover:bg-slate-600 transition-colors"
			title="Scroll to bottom"
		>
			<Icon icon="mdi:chevron-down" width={16} />
		</button>
	{/if}
</div>
