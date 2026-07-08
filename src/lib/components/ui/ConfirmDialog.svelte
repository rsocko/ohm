<script lang="ts">
	import { AlertDialog, AlertDialogContent } from './alert-dialog';
	import Icon from '@iconify/svelte';

	interface Props {
		open: boolean;
		title?: string;
		description?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: 'danger' | 'warning' | 'default';
		onConfirm: () => void;
		onCancel?: () => void;
	}

	let {
		open = $bindable(),
		title = 'Are you sure?',
		description = '',
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		variant = 'default',
		onConfirm,
		onCancel
	}: Props = $props();

	function handleConfirm() {
		open = false;
		onConfirm();
	}

	function handleCancel() {
		open = false;
		onCancel?.();
	}

	const variantStyles = {
		danger: 'bg-red-600 hover:bg-red-500 text-white',
		warning: 'bg-amber-600 hover:bg-amber-500 text-white',
		default: 'bg-indigo-600 hover:bg-indigo-500 text-white',
	};

	const variantIcons = {
		danger: 'mdi:alert-circle-outline',
		warning: 'mdi:alert-outline',
		default: 'mdi:help-circle-outline',
	};
</script>

<AlertDialog bind:open>
	<AlertDialogContent>
		<div class="flex items-start gap-3">
			<span class="w-10 h-10 rounded-full {variant === 'danger' ? 'bg-red-500/10' : variant === 'warning' ? 'bg-amber-500/10' : 'bg-indigo-500/10'} flex items-center justify-center shrink-0 mt-0.5">
				<Icon icon={variantIcons[variant]} width={22} class="{variant === 'danger' ? 'text-red-400' : variant === 'warning' ? 'text-amber-400' : 'text-indigo-400'}" />
			</span>
			<div class="space-y-1.5">
				<h3 class="text-base font-semibold text-white">{title}</h3>
				{#if description}
					<p class="text-sm text-slate-400">{description}</p>
				{/if}
			</div>
		</div>
		<div class="flex justify-end gap-2 mt-5">
			<button
				onclick={handleCancel}
				class="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
			>
				{cancelLabel}
			</button>
			<button
				onclick={handleConfirm}
				class="px-4 py-2 rounded-lg text-sm font-medium transition-colors {variantStyles[variant]}"
			>
				{confirmLabel}
			</button>
		</div>
	</AlertDialogContent>
</AlertDialog>
