<script lang="ts">
	import { Dialog } from 'bits-ui';

	interface Props {
		open: boolean;
		onOpenChange?: (open: boolean) => void;
		children: import('svelte').Snippet;
	}

	let { open = $bindable(), onOpenChange, children }: Props = $props();
</script>

<Dialog.Root bind:open {onOpenChange}>
	{@render children()}
</Dialog.Root>
