<script lang="ts">
	/**
	 * Energy Flow Diagram — animated power flow visualization.
	 *
	 * Pattern adapted from JoshuaDodds/cerbomoticzgx:frontend/static/js/powerflow.js
	 * (ISC license). Uses native SVG <animateMotion> for GPU-composited dot animation
	 * with zero JS animation loops.
	 *
	 * Topology is data-driven: add nodes/edges to extend (battery, EV, etc.)
	 */
	import type { SolarReading } from '$lib/types/energy';

	interface Props {
		solar: SolarReading | null;
		consumptionWatts: number;
	}

	let { solar, consumptionWatts }: Props = $props();

	// --- Power calculations ---
	const solarWatts = $derived(solar?.production ?? 0);
	const gridImportWatts = $derived(
		solar
			? (solar.gridImportW > 0 ? solar.gridImportW : Math.max(consumptionWatts - solarWatts, 0))
			: Math.max(consumptionWatts, 0)
	);
	const gridExportWatts = $derived(
		solar
			? (solar.gridExportW > 0 ? solar.gridExportW : Math.max(solarWatts - consumptionWatts, 0))
			: 0
	);
	const solarToHome = $derived(Math.max(Math.min(solarWatts, consumptionWatts), 0));

	const hasSolar = $derived(solarWatts > 15);
	const isExporting = $derived(hasSolar && gridExportWatts > 15);
	const isImporting = $derived(gridImportWatts > 15 || !hasSolar);

	// --- Topology: nodes + edges (data-driven, extensible) ---
	const PALETTE = {
		solar: '#eab308',
		home: '#3b82f6',
		grid_import: '#ef4444',
		grid_export: '#22c55e',
	};

	// Node positions in viewBox (0 0 340 150)
	const nodes = {
		solar: { x: 60, y: 40, icon: '☀', label: 'Solar' },
		home:  { x: 170, y: 75, icon: '🏠', label: 'Home' },
		grid:  { x: 280, y: 75, icon: '⚡', label: 'Grid' },
	} as const;

	type NodeKey = keyof typeof nodes;
	type PortSide = 'top' | 'bottom' | 'left' | 'right';

	interface Port { x: number; y: number; dx: number; dy: number; }

	function getPort(node: { x: number; y: number }, side: PortSide, offset = 0): Port {
		const hw = 20, hh = 20; // half-width/height of node box
		switch (side) {
			case 'right':  return { x: node.x + hw, y: node.y + offset, dx: 1, dy: 0 };
			case 'left':   return { x: node.x - hw, y: node.y + offset, dx: -1, dy: 0 };
			case 'bottom': return { x: node.x + offset, y: node.y + hh, dx: 0, dy: 1 };
			case 'top':    return { x: node.x + offset, y: node.y - hh, dx: 0, dy: -1 };
		}
	}

	// Cubic bezier between two ports (powerflow.js pathBetween pattern)
	function pathBetween(s: Port, t: Port): string {
		const dist = Math.max(25, Math.hypot(t.x - s.x, t.y - s.y) * 0.42);
		const c1x = s.x + s.dx * dist, c1y = s.y + s.dy * dist;
		const c2x = t.x + t.dx * dist, c2y = t.y + t.dy * dist;
		return `M${s.x.toFixed(1)},${s.y.toFixed(1)} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${t.x.toFixed(1)},${t.y.toFixed(1)}`;
	}

	// Edge paths (computed from port attachment points)
	const pathSolarToHome = $derived(
		pathBetween(getPort(nodes.solar, 'bottom', 4), getPort(nodes.home, 'left', -2))
	);
	const pathGridToHome = $derived(
		pathBetween(getPort(nodes.grid, 'left', 0), getPort(nodes.home, 'right', 0))
	);
	const pathSolarToGrid = $derived(
		pathBetween(getPort(nodes.solar, 'right', -6), getPort(nodes.grid, 'top', -4))
	);

	// --- Animation: speed scaled by power (powerflow.js durFor pattern) ---
	function durFor(watts: number): number {
		const mag = Math.abs(watts);
		if (mag < 300) return 3.6;
		if (mag < 1500) return 3.0;
		if (mag < 5000) return 2.4;
		return 1.8;
	}

	// Dot count: 2 dots per edge (staggered), matching powerflow.js PF_DOTS=2
	const PF_DOTS = 2;

	// --- Edge configuration (reactive) ---
	interface FlowEdge {
		key: string;
		path: string;
		color: string;
		watts: number;
		active: boolean;
		forward: boolean; // true = a→b, false = b→a
	}

	const edges: FlowEdge[] = $derived([
		{
			key: 'solar-home',
			path: pathSolarToHome,
			color: PALETTE.solar,
			watts: solarToHome,
			active: hasSolar && solarToHome > 15,
			forward: true,
		},
		{
			key: 'grid-home',
			path: pathGridToHome,
			color: PALETTE.grid_import,
			watts: gridImportWatts,
			active: isImporting,
			forward: true, // grid → home
		},
		{
			key: 'solar-grid',
			path: pathSolarToGrid,
			color: PALETTE.grid_export,
			watts: gridExportWatts,
			active: isExporting,
			forward: true, // solar → grid (export)
		},
	]);

	// --- Formatting ---
	function formatKW(watts: number): string {
		if (watts >= 1000) return `${(watts / 1000).toFixed(1)} kW`;
		return `${Math.round(watts)} W`;
	}

	// Node appearance based on state
	const gridColor = $derived(isExporting ? PALETTE.grid_export : isImporting ? PALETTE.grid_import : '#475569');
</script>

<div class="rounded-xl border border-slate-700/40 bg-slate-950/60 p-4">
	<div class="mb-2 flex items-center justify-between">
		<div>
			<h3 class="text-sm font-semibold text-white">Energy Flow</h3>
			<p class="text-[11px] text-slate-400">Real-time power distribution</p>
		</div>
		<span class="text-[11px] font-medium text-slate-400 tabular-nums">
			{formatKW(consumptionWatts)} load
		</span>
	</div>

	<svg viewBox="0 0 340 150" class="w-full" style="max-height: 220px;" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<filter id="dot-glow" x="-100%" y="-100%" width="300%" height="300%">
				<feGaussianBlur stdDeviation="2.5" result="blur" />
				<feComposite in="SourceGraphic" in2="blur" operator="over" />
			</filter>
		</defs>

		<!-- Edges: wire traces + animated dots -->
		{#each edges as edge}
			<!-- Faint wide wire glow -->
			<path d={edge.path} fill="none" stroke={edge.color} stroke-width="10"
				stroke-linecap="round" opacity={edge.active ? 0.06 : 0.02} />
			<!-- Visible wire trace -->
			<path d={edge.path} fill="none" stroke={edge.color} stroke-width="2"
				stroke-linecap="round" opacity={edge.active ? 0.35 : 0.1} />
			<!-- Animated dots (powerflow.js pattern: staggered begin, keyPoints for direction) -->
			{#if edge.active}
				{#each Array(PF_DOTS) as _, i}
					{@const dur = durFor(edge.watts)}
					{@const kp = edge.forward ? '0;1' : '1;0'}
					<circle r="4" fill={edge.color} opacity="0.95" filter="url(#dot-glow)">
						<animateMotion
							dur="{dur}s"
							begin="{(-i * dur / PF_DOTS).toFixed(2)}s"
							repeatCount="indefinite"
							calcMode="linear"
							keyPoints={kp}
							keyTimes="0;1"
							path={edge.path}
						/>
					</circle>
				{/each}
			{/if}
		{/each}

		<!-- Flow value labels (positioned at path midpoints) -->
		{#if hasSolar && solarToHome > 15}
			<text x="105" y="72" class="flow-label" fill="#fde68a">{formatKW(solarToHome)}</text>
		{/if}
		{#if isImporting}
			<text x="225" y="65" text-anchor="middle" class="flow-label" fill="#fca5a5">{formatKW(gridImportWatts)}</text>
		{/if}
		{#if isExporting}
			<text x="170" y="25" text-anchor="middle" class="flow-label" fill="#86efac">{formatKW(gridExportWatts)}</text>
		{/if}

		<!-- Nodes -->
		<!-- Solar -->
		<g>
			<rect x="{nodes.solar.x - 20}" y="{nodes.solar.y - 20}" width="40" height="40" rx="12"
				fill={hasSolar ? 'rgba(234,179,8,0.12)' : 'rgba(30,41,59,0.8)'}
				stroke={hasSolar ? 'rgba(234,179,8,0.4)' : 'rgba(71,85,105,0.4)'}
				stroke-width="1.5" />
			<text x={nodes.solar.x} y="{nodes.solar.y + 5}" text-anchor="middle"
				font-size="18" fill={hasSolar ? '#fcd34d' : '#64748b'}>☀</text>
			<text x={nodes.solar.x} y="{nodes.solar.y + 32}" text-anchor="middle"
				class="node-name" fill="#e2e8f0">Solar</text>
			<text x={nodes.solar.x} y="{nodes.solar.y + 44}" text-anchor="middle"
				class="node-val" fill={hasSolar ? '#fde68a' : '#64748b'}>{formatKW(solarWatts)}</text>
		</g>

		<!-- Home -->
		<g>
			<rect x="{nodes.home.x - 20}" y="{nodes.home.y - 20}" width="40" height="40" rx="12"
				fill="rgba(59,130,246,0.12)"
				stroke="rgba(59,130,246,0.4)"
				stroke-width="1.5" />
			<text x={nodes.home.x} y="{nodes.home.y + 6}" text-anchor="middle"
				font-size="18" fill="#93c5fd">🏠</text>
			<text x={nodes.home.x} y="{nodes.home.y + 32}" text-anchor="middle"
				class="node-name" fill="#e2e8f0">Home</text>
			<text x={nodes.home.x} y="{nodes.home.y + 44}" text-anchor="middle"
				class="node-val" fill="#bfdbfe">{formatKW(consumptionWatts)}</text>
		</g>

		<!-- Grid -->
		<g>
			<rect x="{nodes.grid.x - 20}" y="{nodes.grid.y - 20}" width="40" height="40" rx="12"
				fill="{isExporting ? 'rgba(34,197,94,0.12)' : isImporting ? 'rgba(239,68,68,0.12)' : 'rgba(30,41,59,0.8)'}"
				stroke="{isExporting ? 'rgba(34,197,94,0.4)' : isImporting ? 'rgba(239,68,68,0.4)' : 'rgba(71,85,105,0.4)'}"
				stroke-width="1.5" />
			<text x={nodes.grid.x} y="{nodes.grid.y + 5}" text-anchor="middle"
				font-size="16" fill={gridColor}>⚡</text>
			<text x={nodes.grid.x} y="{nodes.grid.y + 32}" text-anchor="middle"
				class="node-name" fill="#e2e8f0">Grid</text>
			<text x={nodes.grid.x} y="{nodes.grid.y + 44}" text-anchor="middle"
				class="node-val" fill={isExporting ? '#bbf7d0' : isImporting ? '#fecaca' : '#64748b'}>
				{isExporting ? formatKW(gridExportWatts) : isImporting ? formatKW(gridImportWatts) : 'Idle'}
			</text>
		</g>
	</svg>
</div>

<style>
	.flow-label {
		font-size: 10px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.node-name {
		font-size: 10px;
		font-weight: 600;
	}

	.node-val {
		font-size: 9px;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	@media (prefers-reduced-motion: reduce) {
		circle {
			display: none;
		}
	}
</style>
