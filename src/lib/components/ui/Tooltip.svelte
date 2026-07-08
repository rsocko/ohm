<script lang="ts">
	/**
	 * Custom tooltip component with arrow, fast show delay, and smart positioning.
	 * Uses fixed positioning to escape overflow containers (popovers, scroll areas).
	 * 
	 * Usage: <Tooltip text="Label"><button>...</button></Tooltip>
	 */

	let {
		text = '',
		children,
		side = 'top',
		delay = 150,
		class: className = ''
	}: {
		text: string;
		children: import('svelte').Snippet;
		side?: 'top' | 'bottom' | 'left' | 'right';
		delay?: number;
		class?: string;
	} = $props();

	let visible = $state(false);
	let tooltipEl: HTMLDivElement | undefined = $state();
	let wrapperEl: HTMLDivElement | undefined = $state();
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let actualSide = $state(side);
	let pos = $state({ top: 0, left: 0 });

	function show() {
		timeoutId = setTimeout(() => {
			visible = true;
			requestAnimationFrame(reposition);
		}, delay);
	}

	function hide() {
		if (timeoutId) clearTimeout(timeoutId);
		visible = false;
	}

	function reposition() {
		if (!tooltipEl || !wrapperEl) return;
		const wr = wrapperEl.getBoundingClientRect();
		const tr = tooltipEl.getBoundingClientRect();
		const gap = 6;
		const margin = 8;

		// Determine side (flip if needed)
		let finalSide = side;
		if (side === 'top' && wr.top - tr.height - gap < 0) finalSide = 'bottom';
		else if (side === 'bottom' && wr.bottom + tr.height + gap > window.innerHeight) finalSide = 'top';
		else if (side === 'left' && wr.left - tr.width - gap < 0) finalSide = 'right';
		else if (side === 'right' && wr.right + tr.width + gap > window.innerWidth) finalSide = 'left';
		actualSide = finalSide;

		let top = 0;
		let left = 0;

		if (finalSide === 'top') {
			top = wr.top - tr.height - gap;
			left = wr.left + wr.width / 2 - tr.width / 2;
		} else if (finalSide === 'bottom') {
			top = wr.bottom + gap;
			left = wr.left + wr.width / 2 - tr.width / 2;
		} else if (finalSide === 'left') {
			top = wr.top + wr.height / 2 - tr.height / 2;
			left = wr.left - tr.width - gap;
		} else {
			top = wr.top + wr.height / 2 - tr.height / 2;
			left = wr.right + gap;
		}

		// Clamp to viewport
		left = Math.max(margin, Math.min(left, window.innerWidth - tr.width - margin));
		top = Math.max(margin, Math.min(top, window.innerHeight - tr.height - margin));

		pos = { top, left };
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={wrapperEl}
	class="relative inline-flex {className}"
	onpointerenter={show}
	onpointerleave={hide}
	onfocusin={show}
	onfocusout={hide}
>
	{@render children()}
	{#if visible && text}
		<div
			bind:this={tooltipEl}
			role="tooltip"
			class="fixed pointer-events-none z-[9999] px-2 py-1 rounded-md bg-slate-800 border border-slate-600/60 shadow-lg text-[10px] font-medium text-slate-100 whitespace-nowrap backdrop-blur-sm"
			style="top: {pos.top}px; left: {pos.left}px;"
		>
			{text}
			<!-- Arrow -->
			<span
				class="absolute w-2 h-2 bg-slate-800 border-slate-600/60 rotate-45
					{actualSide === 'top' ? 'top-full -mt-1 left-1/2 -translate-x-1/2 border-b border-r' : ''}
					{actualSide === 'bottom' ? 'bottom-full -mb-1 left-1/2 -translate-x-1/2 border-t border-l' : ''}
					{actualSide === 'left' ? 'left-full -ml-1 top-1/2 -translate-y-1/2 border-t border-r' : ''}
					{actualSide === 'right' ? 'right-full -mr-1 top-1/2 -translate-y-1/2 border-b border-l' : ''}"
			></span>
		</div>
	{/if}
</div>
