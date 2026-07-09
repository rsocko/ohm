<script lang="ts">
	/**
	 * TextShimmer — animated loading text with shimmer effect.
	 * Used in ThinkingBar, Steps, and anywhere loading text is shown.
	 */
	interface Props {
		text?: string;
		class?: string;
	}

	let { text = 'Thinking', class: className = '' }: Props = $props();
</script>

<span class="text-shimmer inline-block {className}" aria-label="{text}">
	{text}
</span>

<style>
	.text-shimmer {
		background: linear-gradient(
			90deg,
			rgba(148, 163, 184, 0.4) 0%,
			rgba(148, 163, 184, 0.9) 40%,
			rgba(148, 163, 184, 0.9) 60%,
			rgba(148, 163, 184, 0.4) 100%
		);
		background-size: 200% 100%;
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		animation: shimmer 2s ease-in-out infinite;
	}

	@keyframes shimmer {
		0% { background-position: 100% 0; }
		100% { background-position: -100% 0; }
	}
</style>
