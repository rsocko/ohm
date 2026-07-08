<script lang="ts">
	/** Size (px) of the loader's bounding box. Orbit radii scale proportionally. */
	let { size = 140 }: { size?: number } = $props();
</script>

<!--
	"Ohm" trailing-electron loader (variant D from branding-ohmni-motion.html):
	3 electrons on tilted orbits around a central Ω, each with a fading comet tail.
-->
<div class="ohm-loader" style="width: {size}px; height: {size}px; --ohm-loader-scale: {size / 140};">
	<div class="omega">&Omega;</div>
	<div class="trail trail-1b"></div>
	<div class="trail trail-1a"></div>
	<div class="electron electron-1"></div>
	<div class="trail trail-2b"></div>
	<div class="trail trail-2a"></div>
	<div class="electron electron-2"></div>
	<div class="electron electron-3"></div>
</div>

<style>
	.ohm-loader {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.omega {
		position: relative;
		z-index: 2;
		font-size: calc(3.5rem * var(--ohm-loader-scale));
		font-weight: 700;
		color: var(--color-accent);
	}

	.electron,
	.trail {
		position: absolute;
		top: 50%;
		left: 50%;
		border-radius: 50%;
	}

	.electron {
		width: calc(8px * var(--ohm-loader-scale));
		height: calc(8px * var(--ohm-loader-scale));
		margin: calc(-4px * var(--ohm-loader-scale)) 0 0 calc(-4px * var(--ohm-loader-scale));
	}

	.trail {
		width: calc(5px * var(--ohm-loader-scale));
		height: calc(5px * var(--ohm-loader-scale));
		margin: calc(-2.5px * var(--ohm-loader-scale)) 0 0 calc(-2.5px * var(--ohm-loader-scale));
	}

	.electron-1 {
		background: var(--color-info);
		box-shadow:
			0 0 10px rgba(34, 211, 238, 0.8),
			-4px 0 6px rgba(34, 211, 238, 0.4),
			-8px 0 4px rgba(34, 211, 238, 0.2);
		animation: orbit-d1 2.5s linear infinite;
	}

	.electron-2 {
		background: var(--color-energy);
		box-shadow:
			0 0 10px rgba(245, 166, 35, 0.8),
			-4px 0 6px rgba(245, 166, 35, 0.4),
			-8px 0 4px rgba(245, 166, 35, 0.2);
		animation: orbit-d2 3s linear infinite;
	}

	.electron-3 {
		background: var(--color-accent);
		box-shadow:
			0 0 10px rgba(99, 102, 241, 0.8),
			-4px 0 6px rgba(99, 102, 241, 0.4),
			-8px 0 4px rgba(99, 102, 241, 0.2);
		animation: orbit-d3 3.8s linear infinite;
	}

	.trail-1a {
		background: rgba(34, 211, 238, 0.3);
		animation: orbit-d1 2.5s linear infinite;
		animation-delay: 0.12s;
	}

	.trail-1b {
		background: rgba(34, 211, 238, 0.15);
		animation: orbit-d1 2.5s linear infinite;
		animation-delay: 0.24s;
	}

	.trail-2a {
		background: rgba(245, 166, 35, 0.3);
		animation: orbit-d2 3s linear infinite;
		animation-delay: 0.14s;
	}

	.trail-2b {
		background: rgba(245, 166, 35, 0.15);
		animation: orbit-d2 3s linear infinite;
		animation-delay: 0.28s;
	}

	@keyframes orbit-d1 {
		0% { transform: rotate(0deg) translateX(calc(60px * var(--ohm-loader-scale))) scale(1); opacity: 1; }
		25% { transform: rotate(90deg) translateX(calc(60px * var(--ohm-loader-scale))) scale(1.1); opacity: 1; }
		50% { transform: rotate(180deg) translateX(calc(60px * var(--ohm-loader-scale))) scale(0.5); opacity: 0.2; }
		75% { transform: rotate(270deg) translateX(calc(60px * var(--ohm-loader-scale))) scale(0.5); opacity: 0.2; }
		100% { transform: rotate(360deg) translateX(calc(60px * var(--ohm-loader-scale))) scale(1); opacity: 1; }
	}

	@keyframes orbit-d2 {
		0% { transform: rotate(60deg) translateX(calc(52px * var(--ohm-loader-scale))) translateY(calc(10px * var(--ohm-loader-scale))) scale(0.5); opacity: 0.2; }
		25% { transform: rotate(150deg) translateX(calc(52px * var(--ohm-loader-scale))) translateY(calc(10px * var(--ohm-loader-scale))) scale(0.5); opacity: 0.2; }
		50% { transform: rotate(240deg) translateX(calc(52px * var(--ohm-loader-scale))) translateY(calc(10px * var(--ohm-loader-scale))) scale(1.1); opacity: 1; }
		75% { transform: rotate(330deg) translateX(calc(52px * var(--ohm-loader-scale))) translateY(calc(10px * var(--ohm-loader-scale))) scale(1); opacity: 1; }
		100% { transform: rotate(420deg) translateX(calc(52px * var(--ohm-loader-scale))) translateY(calc(10px * var(--ohm-loader-scale))) scale(0.5); opacity: 0.2; }
	}

	@keyframes orbit-d3 {
		0% { transform: rotate(0deg) translateY(calc(55px * var(--ohm-loader-scale))) scale(0.5); opacity: 0.2; }
		35% { transform: rotate(126deg) translateY(calc(55px * var(--ohm-loader-scale))) scale(1); opacity: 1; }
		65% { transform: rotate(234deg) translateY(calc(55px * var(--ohm-loader-scale))) scale(1.1); opacity: 1; }
		100% { transform: rotate(360deg) translateY(calc(55px * var(--ohm-loader-scale))) scale(0.5); opacity: 0.2; }
	}

	@media (prefers-reduced-motion: reduce) {
		.electron,
		.trail {
			animation: none;
		}
	}
</style>
