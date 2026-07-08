<script lang="ts">
	import { Dialog } from 'bits-ui';

	interface Props {
		class?: string;
		children: import('svelte').Snippet;
	}

	let { class: className = '', children }: Props = $props();
</script>

<Dialog.Portal>
	<Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity" />
	<Dialog.Content class="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-700/60 bg-slate-900 p-6 shadow-2xl {className}">
		{@render children()}
	</Dialog.Content>
</Dialog.Portal>
