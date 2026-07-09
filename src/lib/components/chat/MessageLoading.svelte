<script lang="ts">
	/**
	 * MessageLoading — enhanced typing indicator with variants.
	 * Supports dots (default) and bar style.
	 */
	interface Props {
		variant?: 'dots' | 'bar';
	}

	let { variant = 'dots' }: Props = $props();
</script>

<div class="flex justify-start">
	{#if variant === 'dots'}
		<div class="bg-slate-700/80 rounded-2xl rounded-bl-sm px-4 py-3">
			<div class="flex gap-1.5">
				<span class="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
				<span class="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
				<span class="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
			</div>
		</div>
	{:else}
		<div class="bg-slate-700/80 rounded-2xl rounded-bl-sm px-4 py-3 w-48">
			<div class="loading-bar h-2 rounded-full overflow-hidden bg-slate-600">
				<div class="loading-bar-inner h-full bg-indigo-400/60 rounded-full"></div>
			</div>
		</div>
	{/if}
</div>

<style>
	.loading-bar-inner {
		width: 40%;
		animation: slide 1.5s ease-in-out infinite;
	}

	@keyframes slide {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(350%); }
	}
</style>
