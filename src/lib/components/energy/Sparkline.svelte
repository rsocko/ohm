<script lang="ts">
	/**
	 * Inline SVG sparkline for showing recent power draw trend.
	 * Renders a tiny line chart with optional fill gradient.
	 */
	interface Props {
		/** Array of numeric values (most recent last) */
		values: number[];
		/** Width in px */
		width?: number;
		/** Height in px */
		height?: number;
		/** Stroke color (CSS) */
		color?: string;
	}

	let { values, width = 80, height = 20, color = '#34d399' }: Props = $props();

	const points = $derived.by(() => {
		if (values.length < 2) return '';
		const max = Math.max(...values, 1);
		const step = width / (values.length - 1);
		return values
			.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 2) - 1).toFixed(1)}`)
			.join(' ');
	});

	const fillPoints = $derived.by(() => {
		if (!points) return '';
		return `0,${height} ${points} ${width},${height}`;
	});
</script>

{#if values.length >= 2}
	<svg {width} {height} class="inline-block" viewBox="0 0 {width} {height}" preserveAspectRatio="none">
		<!-- Background + baseline for visual bounds -->
		<rect x="0" y="0" width={width} height={height} rx="2" fill="currentColor" fill-opacity="0.04" />
		<line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="currentColor" stroke-opacity="0.1" stroke-width="0.5" />
		<polygon points={fillPoints} fill={color} fill-opacity="0.15" />
		<polyline
			{points}
			fill="none"
			stroke={color}
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			vector-effect="non-scaling-stroke"
		/>
	</svg>
{/if}
