<script lang="ts">
	/**
	 * VoiceInput — browser-native speech-to-text mic button with visual feedback.
	 * Uses the Web Speech API (SpeechRecognition). Hidden when unsupported.
	 * Auto-submits after 2s of silence or manual "Done" tap.
	 */
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';

	interface Props {
		disabled?: boolean;
		onTranscript?: (text: string) => void;
		onInterim?: (text: string) => void;
		onListeningChange?: (isListening: boolean) => void;
	}

	let { disabled = false, onTranscript, onInterim, onListeningChange }: Props = $props();

	let supported = $state(false);
	let listening = $state(false);
	let interimText = $state('');
	let finalText = $state('');
	let recognition: SpeechRecognition | null = $state(null);
	let silenceTimer: ReturnType<typeof setTimeout> | null = null;

	/** Whether the component is currently recording. Exposed for parent layout control. */
	export function isListening() {
		return listening;
	}

	const SILENCE_TIMEOUT_MS = 2000;

	onMount(() => {
		const SpeechRecognition =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		if (!SpeechRecognition) return;

		supported = true;
		const rec = new SpeechRecognition();
		rec.continuous = true;
		rec.interimResults = true;
		rec.lang = 'en-US';
		rec.maxAlternatives = 1;

		rec.onresult = (event: SpeechRecognitionEvent) => {
			clearSilenceTimer();

			let interim = '';
			let final = '';
			for (let i = 0; i < event.results.length; i++) {
				const result = event.results[i];
				if (result.isFinal) {
					final += result[0].transcript;
				} else {
					interim += result[0].transcript;
				}
			}

			finalText = final;
			interimText = interim;
			onInterim?.(final + interim);

			// Restart silence timer
			silenceTimer = setTimeout(() => {
				stopListening();
			}, SILENCE_TIMEOUT_MS);
		};

		rec.onerror = (event: SpeechRecognitionErrorEvent) => {
			if (event.error === 'no-speech' || event.error === 'aborted') {
				// Non-fatal — just stop
				stopListening();
				return;
			}
			console.error('SpeechRecognition error:', event.error);
			stopListening();
		};

		rec.onend = () => {
			if (listening) {
				// Submit whatever we have
				submit();
			}
		};

		recognition = rec;
	});

	function clearSilenceTimer() {
		if (silenceTimer) {
			clearTimeout(silenceTimer);
			silenceTimer = null;
		}
	}

	function startListening() {
		if (!recognition || disabled) return;
		finalText = '';
		interimText = '';
		listening = true;
		onListeningChange?.(true);
		try {
			recognition.start();
		} catch {
			listening = false;
			onListeningChange?.(false);
		}
	}

	function stopListening() {
		clearSilenceTimer();
		if (recognition) {
			listening = false;
			onListeningChange?.(false);
			try {
				recognition.stop();
			} catch {
				// Already stopped
			}
		}
		submit();
	}

	function cancel() {
		clearSilenceTimer();
		if (recognition) {
			listening = false;
			onListeningChange?.(false);
			try {
				recognition.abort();
			} catch {
				// Already stopped
			}
		}
		finalText = '';
		interimText = '';
		onInterim?.('');
	}

	function submit() {
		const text = (finalText + interimText).trim();
		if (text) {
			onTranscript?.(text);
		}
		finalText = '';
		interimText = '';
		listening = false;
	}

	export function isSupported() {
		return supported;
	}
</script>

{#if supported}
	{#if listening}
		<!-- Listening overlay -->
		<div class="flex items-center gap-2 w-full">
			<div class="flex-1 relative bg-slate-900/80 border border-red-500/40 rounded-xl px-4 py-3 min-h-[44px]">
				<!-- Pulsing indicator -->
				<div class="flex items-center gap-2">
					<span class="relative flex h-3 w-3 shrink-0">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
						<span class="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
					</span>
					<span class="text-sm text-slate-300 truncate">
						{#if finalText || interimText}
							{finalText}<span class="text-slate-500">{interimText}</span>
						{:else}
							<span class="text-slate-500">Listening...</span>
						{/if}
					</span>
				</div>
			</div>
			<button
				onclick={stopListening}
				class="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-3 rounded-xl font-medium text-sm active:scale-[0.96] transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
				aria-label="Done — send transcript"
			>
				<Icon icon="mdi:check" width={18} />
			</button>
			<button
				onclick={cancel}
				class="bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-3 rounded-xl font-medium text-sm active:scale-[0.96] transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
				aria-label="Cancel voice input"
			>
				<Icon icon="mdi:close" width={18} />
			</button>
		</div>
	{:else}
		<!-- Mic button (idle state) -->
		<button
			onclick={startListening}
			{disabled}
			class="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-slate-300 hover:text-white px-3 py-3 rounded-xl text-sm active:scale-[0.96] transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
			aria-label="Voice input"
			title="Tap to speak"
		>
			<Icon icon="mdi:microphone" width={18} />
		</button>
	{/if}
{/if}
