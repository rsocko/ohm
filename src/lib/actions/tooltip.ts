/**
 * Svelte action for styled tooltips on any element.
 * Shows on hover with fast delay (150ms), auto-flips to avoid viewport clipping,
 * and has an arrow pointing toward the trigger element.
 * 
 * Usage: <button use:tooltip={'Device Name'}>...</button>
 * Or:    <button use:tooltip={{ text: 'Name', side: 'bottom' }}>...</button>
 */

interface TooltipOptions {
	text: string;
	side?: 'top' | 'bottom' | 'left' | 'right';
	delay?: number;
}

export function tooltip(node: HTMLElement, options: string | TooltipOptions) {
	let tip: HTMLDivElement | null = null;
	let arrow: HTMLSpanElement | null = null;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let opts: TooltipOptions = typeof options === 'string' ? { text: options } : options;

	// Remove native title to prevent double tooltip
	const originalTitle = node.getAttribute('title');
	node.removeAttribute('title');

	function getOpts() {
		return {
			text: opts.text || '',
			side: opts.side || 'top',
			delay: opts.delay ?? 150
		};
	}

	function show() {
		const { text, delay } = getOpts();
		if (!text) return;

		timeoutId = setTimeout(() => {
			createTooltip();
		}, delay);
	}

	function hide() {
		if (timeoutId) clearTimeout(timeoutId);
		if (tip) {
			tip.remove();
			tip = null;
			arrow = null;
		}
	}

	function createTooltip() {
		const { text, side } = getOpts();
		if (!text) return;

		tip = document.createElement('div');
		tip.setAttribute('role', 'tooltip');
		tip.style.cssText = `
			position: fixed;
			z-index: 9999;
			padding: 4px 8px;
			border-radius: 6px;
			background: rgb(30 41 59 / 0.95);
			border: 1px solid rgb(71 85 105 / 0.6);
			box-shadow: 0 4px 12px rgb(0 0 0 / 0.3);
			backdrop-filter: blur(8px);
			font-size: 10px;
			font-weight: 500;
			color: rgb(241 245 249);
			white-space: nowrap;
			pointer-events: none;
			opacity: 0;
			transition: opacity 0.12s ease-out;
		`;
		tip.textContent = text;

		arrow = document.createElement('span');
		arrow.style.cssText = `
			position: absolute;
			width: 7px;
			height: 7px;
			background: rgb(30 41 59 / 0.95);
			border: 1px solid rgb(71 85 105 / 0.6);
			transform: rotate(45deg);
		`;
		tip.appendChild(arrow);

		document.body.appendChild(tip);
		positionTooltip(side);

		// Fade in
		requestAnimationFrame(() => {
			if (tip) tip.style.opacity = '1';
		});
	}

	function positionTooltip(preferredSide: string) {
		if (!tip || !arrow) return;
		const rect = node.getBoundingClientRect();
		const tipRect = tip.getBoundingClientRect();
		const gap = 8;

		let side = preferredSide;

		// Flip if clipping
		if (side === 'top' && rect.top - tipRect.height - gap < 0) side = 'bottom';
		else if (side === 'bottom' && rect.bottom + tipRect.height + gap > window.innerHeight) side = 'top';
		else if (side === 'left' && rect.left - tipRect.width - gap < 0) side = 'right';
		else if (side === 'right' && rect.right + tipRect.width + gap > window.innerWidth) side = 'left';

		let top = 0;
		let left = 0;

		if (side === 'top') {
			top = rect.top - tipRect.height - gap;
			left = rect.left + rect.width / 2 - tipRect.width / 2;
		} else if (side === 'bottom') {
			top = rect.bottom + gap;
			left = rect.left + rect.width / 2 - tipRect.width / 2;
		} else if (side === 'left') {
			top = rect.top + rect.height / 2 - tipRect.height / 2;
			left = rect.left - tipRect.width - gap;
		} else {
			top = rect.top + rect.height / 2 - tipRect.height / 2;
			left = rect.right + gap;
		}

		// Clamp to viewport
		left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
		top = Math.max(4, Math.min(top, window.innerHeight - tipRect.height - 4));

		tip.style.top = `${top}px`;
		tip.style.left = `${left}px`;

		// Arrow positioning
		const arrowHalf = 3.5;
		if (side === 'top') {
			arrow.style.bottom = '-4px';
			arrow.style.top = 'auto';
			arrow.style.borderTop = 'none';
			arrow.style.borderLeft = 'none';
			const arrowLeft = rect.left + rect.width / 2 - left - arrowHalf;
			arrow.style.left = `${Math.max(8, Math.min(arrowLeft, tipRect.width - 12))}px`;
		} else if (side === 'bottom') {
			arrow.style.top = '-4px';
			arrow.style.bottom = 'auto';
			arrow.style.borderBottom = 'none';
			arrow.style.borderRight = 'none';
			const arrowLeft = rect.left + rect.width / 2 - left - arrowHalf;
			arrow.style.left = `${Math.max(8, Math.min(arrowLeft, tipRect.width - 12))}px`;
		} else if (side === 'left') {
			arrow.style.right = '-4px';
			arrow.style.left = 'auto';
			arrow.style.borderLeft = 'none';
			arrow.style.borderBottom = 'none';
			const arrowTop = rect.top + rect.height / 2 - top - arrowHalf;
			arrow.style.top = `${Math.max(8, Math.min(arrowTop, tipRect.height - 12))}px`;
		} else {
			arrow.style.left = '-4px';
			arrow.style.right = 'auto';
			arrow.style.borderRight = 'none';
			arrow.style.borderTop = 'none';
			const arrowTop = rect.top + rect.height / 2 - top - arrowHalf;
			arrow.style.top = `${Math.max(8, Math.min(arrowTop, tipRect.height - 12))}px`;
		}
	}

	node.addEventListener('pointerenter', show);
	node.addEventListener('pointerleave', hide);
	node.addEventListener('pointerdown', hide);

	return {
		update(newOptions: string | TooltipOptions) {
			opts = typeof newOptions === 'string' ? { text: newOptions } : newOptions;
			node.removeAttribute('title');
			// If tooltip is currently showing, update it
			if (tip) {
				hide();
				show();
			}
		},
		destroy() {
			hide();
			node.removeEventListener('pointerenter', show);
			node.removeEventListener('pointerleave', hide);
			node.removeEventListener('pointerdown', hide);
		}
	};
}
