<script lang="ts">
	import Icon from '@iconify/svelte';
	import { animate } from 'motion';
	import { flip } from 'svelte/animate';
	import type { EnergyInsightItem } from '$lib/services/energy/insights';
	import type { TransitionConfig } from 'svelte/transition';

	interface Props {
		insights: EnergyInsightItem[];
		compact?: boolean;
	}

	let { insights, compact = false }: Props = $props();

	const toneStyles = {
		solar: {
			border: 'border-amber-400',
			icon: 'text-amber-300',
			iconBg: 'bg-amber-500/15'
		},
		consumption: {
			border: 'border-indigo-400',
			icon: 'text-indigo-300',
			iconBg: 'bg-indigo-500/15'
		},
		comparison: {
			border: 'border-indigo-400',
			icon: 'text-indigo-300',
			iconBg: 'bg-indigo-500/15'
		},
		efficiency: {
			border: 'border-emerald-400',
			icon: 'text-emerald-300',
			iconBg: 'bg-emerald-500/15'
		}
	} as const;

	const visibleInsights = $derived(compact ? insights.slice(0, 3) : insights);

	const reducedMotion = typeof window !== 'undefined'
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false;

	// Motion-powered entrance: spring physics on translateY + scale, with blur & opacity
	function motionEnter(node: HTMLElement) {
		if (reducedMotion) return;
		// Start hidden
		node.style.opacity = '0';
		node.style.filter = 'blur(4px)';
		node.style.transform = 'translateY(20px) scale(0.96)';

		animate(
			node,
			{
				opacity: 1,
				filter: 'blur(0px)',
				transform: 'translateY(0px) scale(1)'
			},
			{
				type: 'spring',
				visualDuration: 0.4,
				bounce: 0.15
			} as any
		);
	}

	// Exit to top: quick fade + slide up (CSS transition for Svelte out:)
	function exitToTop(_node: Element): TransitionConfig {
		if (reducedMotion) return { duration: 0 };
		return {
			duration: 250,
			css: (t) => {
				const eased = t * t;
				return `
					opacity: ${eased};
					transform: translateY(${(1 - eased) * -14}px) scale(${0.97 + eased * 0.03});
					filter: blur(${(1 - eased) * 2}px);
				`;
			}
		};
	}
</script>

{#if visibleInsights.length > 0}
	<div class={`grid gap-3 ${compact ? '' : 'lg:grid-cols-2 xl:grid-cols-3'}`}>
		{#each visibleInsights as insight (insight.id)}
			{@const tone = toneStyles[insight.tone]}
			<div
				class={`card border-l-4 ${tone.border} ${compact ? 'p-3.5' : 'p-4'}`}
				use:motionEnter
				out:exitToTop
				animate:flip={{ duration: reducedMotion ? 0 : 320 }}
			>
				<div class="flex items-start gap-3">
					<div class={`rounded-md ${tone.iconBg} p-2 ${tone.icon}`}>
						<Icon icon={insight.icon} width={compact ? 16 : 18} />
					</div>
					<div class="min-w-0">
						<h3 class={`font-semibold text-fg ${compact ? 'text-xs' : 'text-sm'}`}>{insight.title}</h3>
						<p class={`mt-1 text-fg-secondary ${compact ? 'text-xs' : 'text-sm'}`}>{insight.description}</p>
					</div>
				</div>
			</div>
		{/each}
	</div>
{/if}
