<script lang="ts">
	interface Props {
		onselect: (text: string) => void;
		/** Max chips to show at once */
		count?: number;
	}

	let { onselect, count = 4 }: Props = $props();

	const allSuggestions = [
		// Energy & power
		"What's using the most power right now?",
		'Compare today vs yesterday energy usage',
		'Which circuits are unmonitored?',
		'Show my highest-load breakers',
		'How much solar did I produce today?',
		// Circuits & panels
		'Which circuit is the kitchen on?',
		"What's on circuit 7?",
		'Garage panel summary',
		'List all 20A circuits',
		'Which breakers are double-pole?',
		// Rooms & devices
		'Show all GFCI outlets',
		'How many devices in the basement?',
		'Rename kitchen lights',
		'What rooms have no loads mapped?',
		// Utility
		'Summarize my electrical system',
		'What needs attention?',
	];

	// Pick a random subset on mount (stable for the session)
	const shuffled = allSuggestions.sort(() => Math.random() - 0.5);
	const visible = $derived(shuffled.slice(0, count));
</script>

<div class="flex flex-wrap justify-center gap-1.5">
	{#each visible as suggestion}
		<button
			class="shrink-0 px-3 py-1.5 rounded-full text-[11px] bg-slate-700/80 border border-slate-600/50 text-slate-400 hover:text-white hover:border-slate-400/50 active:scale-[0.96] transition-colors min-h-[32px]"
			onclick={() => onselect(suggestion)}
		>
			{suggestion}
		</button>
	{/each}
</div>
