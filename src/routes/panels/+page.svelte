<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { page } from '$app/state';
	import Icon from '@iconify/svelte';
	import { toast } from 'svelte-sonner';
	import { getDisplayName } from '$lib/utils/display-name';
	import PanelLabelActions from '$lib/components/labels/PanelLabelActions.svelte';
	import LabelPreview from '$lib/components/labels/LabelPreview.svelte';
	import { renderCircuitLabel, renderQrLabel, buildCircuitUrl, getLabelDimensions, circuitTemplateFromConfig } from '$lib/services/label-printing';
	import type { RenderedLabel, PrinterConfig } from '$lib/services/label-printing';
	import type { LiveSSEData } from '$lib/types/energy';
	import PanelARView from '$lib/components/ar/PanelARView.svelte';
	import EntityPicker from '$lib/components/energy/EntityPicker.svelte';
	import Sparkline from '$lib/components/energy/Sparkline.svelte';

	interface V3Record {
		id: number;
		fields: Record<string, unknown>;
	}

	interface Attachment {
		path: string;
		title: string;
		mimetype: string;
		signedPath: string;
		width: number;
		height: number;
	}

	import { dataStore, ensureLoaded, refresh } from '$lib/stores/data.svelte';
	import { homeFiltered, homeContext } from '$lib/stores/home-context.svelte';

	let panels: V3Record[] = $state([]);
	let circuits: V3Record[] = $state([]);
	let allLoads: V3Record[] = $state([]);
	let allReceptacles: V3Record[] = $state([]);
	let loading = $state(true);
	const isLocked = $derived(homeContext.isLocked);
	let selectedPanelId: number | null = $state(null);
	let expandedCircuit: number | null = $state(null);
	let highlightedCircuitId: number | null = $state(null);
	let searchQuery = $state('');
	let slideDirection: 'left' | 'right' = $state('right');
	let viewMode: 'schematic' | 'photo' = $state('schematic');
	let showARView = $state(false);
	let calibrating = $state(false);
	let calibrationCorners: { x: number; y: number }[] = $state([]);
	let calibrationStep: 'corners' | 'done' = $state('corners');
	let deskewedDataUrl: string | null = $state(null);
	let deskewing = $state(false);
	let showCalibrationMenu = $state(false);
	let showOverlayLabels = $state(true);
	let refining = $state(false);
	let showLabelPrint = $state(false);
	let highlightEmptyCircuits = $state(false);
	let labelPreviewOpen = $state(false);
	let labelPreviewLabel: RenderedLabel | null = $state(null);
	let labelPreviewTitle = $state('');
	let labelPreviewWidthMm = $state(40);
	let labelPreviewHeightMm = $state(12);
	let gridTopPct = $state(2);    // % from top where breaker grid starts
	let gridBottomPct = $state(98); // % from top where breaker grid ends
	let calibrationLoadVersion = 0;
	let activeDeskewRequestId = 0;

	// Create Panel state
	let showCreatePanel = $state(false);
	let newPanelName = $state('');
	let newPanelType: 'Main' | 'Sub' = $state('Main');
	let newPanelSpaces = $state('');
	let creatingPanel = $state(false);

	async function createPanel() {
		if (!newPanelName.trim()) return;
		creatingPanel = true;
		try {
			const fields: Record<string, unknown> = {
				Name: newPanelName.trim(),
				'Panel Type': newPanelType
			};
			if (newPanelSpaces) fields['Total Spaces'] = Number(newPanelSpaces);

			// Link to an area in the selected home (first area available)
			const linkUpdates: { title: string; ids: number[] }[] = [];
			const homeAreas = homeFiltered.areas;
			if (homeAreas.length > 0) {
				linkUpdates.push({ title: 'Area', ids: [homeAreas[0].id] });
			}

			const resp = await fetch('/api/nocodb', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Panel', fields, linkUpdates })
			});

			if (!resp.ok) throw new Error('Failed to create panel');
			toast.success(`Created "${newPanelName.trim()}"`);
			showCreatePanel = false;
			newPanelName = '';
			newPanelSpaces = '';
			newPanelType = 'Main';
				// Reload data from server
				await refresh();
			panels = homeFiltered.panels;
			circuits = homeFiltered.circuits;
			allLoads = homeFiltered.loads;
			allReceptacles = homeFiltered.receptacles;
				// Select the newly created panel (last one in the list)
				if (panels.length > 0) selectedPanelId = panels[panels.length - 1].id;
		} catch (err) {
			toast.error('Failed to create panel');
		} finally {
			creatingPanel = false;
		}
	}

	// Create Circuit state
	let showCreateCircuit = $state(false);
	let newCircuitName = $state('');
	let newCircuitNumber = $state('');
	let newCircuitAmps: string = $state('20');
	let newCircuitVoltage: '120V' | '240V' = $state('120V');
	let creatingCircuit = $state(false);

	async function createCircuit() {
		if (!newCircuitName.trim() || !selectedPanelId) return;
		creatingCircuit = true;
		try {
			const fields: Record<string, unknown> = {
				Name: newCircuitName.trim(),
				Amps: Number(newCircuitAmps) || 20,
				Voltage: newCircuitVoltage
			};
			if (newCircuitNumber) fields['Number'] = Number(newCircuitNumber);

			const linkUpdates: { title: string; ids: number[] }[] = [
				{ title: 'Panel', ids: [selectedPanelId] }
			];

			const resp = await fetch('/api/nocodb', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Circuit', fields, linkUpdates })
			});

			if (!resp.ok) throw new Error('Failed to create circuit');
			toast.success(`Created circuit "${newCircuitName.trim()}"`);
			showCreateCircuit = false;
			newCircuitName = '';
			newCircuitNumber = '';
			newCircuitAmps = '20';
			newCircuitVoltage = '120V';
			// Reload data from server
			await refresh();
			panels = homeFiltered.panels;
			circuits = homeFiltered.circuits;
			allLoads = homeFiltered.loads;
			allReceptacles = homeFiltered.receptacles;
		} catch (err) {
			toast.error('Failed to create circuit');
		} finally {
			creatingCircuit = false;
		}
	}

	// Energy mapping state
	interface EnergyMapping {
		circuitId: number;
		powerEntityId: string | null;
		energyEntityId: string | null;
		circuitName: string;
		panelName: string;
	}
	let energyMappings: Map<number, EnergyMapping> = $state(new Map());
	let energyMappingsVersion = $state(0);
	let savingMapping = $state(false);
	let liveCircuitWatts: Map<number, number> = $state(new Map());
	let liveEnergySource: EventSource | null = null;
	// Rolling sparkline buffer: last 20 readings per circuit
	const SPARKLINE_MAX = 20;
	let sparklineHistory: Map<number, number[]> = $state(new Map());

	const selectedPanel = $derived(panels.find((p) => p.id === selectedPanelId));
	const panelCircuits = $derived(
		circuits
			.filter((c) => {
				const panel = c.fields.Panel as { id: number } | undefined;
				return panel && panel.id === selectedPanelId;
			})
			.sort((a, b) => ((a.fields.Number as number) || 99) - ((b.fields.Number as number) || 99))
	);

	const filteredCircuits = $derived(
		searchQuery.trim()
			? panelCircuits.filter((c) => {
					const q = searchQuery.toLowerCase();
					const name = ((c.fields.Name as string) || '').toLowerCase();
					const areaField = c.fields['Area Name'];
					const area = Array.isArray(areaField) ? areaField.filter(Boolean).join(' ').toLowerCase() : ((areaField as string) || '').toLowerCase();
					const loadArr = c.fields['Load Name(s)'];
					const loadStr = Array.isArray(loadArr) ? loadArr.filter(Boolean).join(' ').toLowerCase() : ((loadArr as string) || '').toLowerCase();
					const recArr = c.fields['Receptacle Name(s)'];
					const recStr = Array.isArray(recArr) ? recArr.filter(Boolean).join(' ').toLowerCase() : ((recArr as string) || '').toLowerCase();
					return name.includes(q) || area.includes(q) || loadStr.includes(q) || recStr.includes(q);
				})
			: panelCircuits
	);

	// Build columns using US standard: odd=Left, even=Right
	const leftCircuits = $derived(filteredCircuits.filter((c) => (c.fields.Number as number) % 2 === 1));
	const rightCircuits = $derived(filteredCircuits.filter((c) => (c.fields.Number as number) % 2 === 0));

	// Group circuits into display rows for schematic
	// Returns: { type: 'single'|'double'|'tandem', circuits: V3Record[] }
	interface SchematicRow {
		type: 'single' | 'double' | 'tandem';
		circuits: V3Record[];
	}
	function groupForSchematic(circuits: V3Record[]): SchematicRow[] {
		const rows: SchematicRow[] = [];
		const sorted = [...circuits].sort((a, b) => (a.fields.Number as number) - (b.fields.Number as number));
		const processed = new Set<number>();

		for (const circuit of sorted) {
			if (processed.has(circuit.id)) continue;
			processed.add(circuit.id);

			// Check if tandem — find its partner
			const tandem = parseTandemSlot(circuit);
			if (tandem) {
				const partner = sorted.find(c => 
					!processed.has(c.id) && parseTandemSlot(c)?.baseSlot === tandem.baseSlot
				);
				if (partner) {
					processed.add(partner.id);
					// Sort by position (1 first, 2 second)
					const pair = [circuit, partner].sort((a, b) => 
						(parseTandemSlot(a)?.position || 0) - (parseTandemSlot(b)?.position || 0)
					);
					rows.push({ type: 'tandem', circuits: pair });
				} else {
					rows.push({ type: 'single', circuits: [circuit] });
				}
				continue;
			}

			// Check if double-pole
			if (inferPoles(circuit) === 2) {
				rows.push({ type: 'double', circuits: [circuit] });
			} else {
				rows.push({ type: 'single', circuits: [circuit] });
			}
		}
		return rows;
	}

	function createSchematicRowMemoizer() {
		let previousKey = '';
		let previousRows: SchematicRow[] = [];

		return (sideCircuits: V3Record[]) => {
			const key = sideCircuits
				.map((circuit) => `${circuit.id}:${String(circuit.fields['Panel Slot'] || circuit.fields.Number || '')}`)
				.join('|');
			if (key === previousKey) return previousRows;
			previousKey = key;
			previousRows = groupForSchematic(sideCircuits);
			return previousRows;
		};
	}

	const getLeftRows = createSchematicRowMemoizer();
	const getRightRows = createSchematicRowMemoizer();
	const leftRows = $derived.by(() => getLeftRows(leftCircuits));
	const rightRows = $derived.by(() => getRightRows(rightCircuits));

	// Panel summary stats
	const panelStats = $derived.by(() => {
		let gfci = 0, afci = 0, twoForty = 0, slotsUsed = 0;
		for (const c of panelCircuits) {
			if (c.fields['GFCI Protected'] || c.fields.GFCI_Protected) gfci++;
			if (c.fields['AFCI Protected'] || c.fields.AFCI_Protected) afci++;
			const voltage = c.fields.Voltage as string | undefined;
			const amps = c.fields.Amps as number | undefined;
			if (voltage === '240V' || (amps && amps >= 30)) twoForty++;
			slotsUsed += inferPoles(c);
		}
		const capacity = (selectedPanel?.fields.Capacity as number) || 0;
		const slotsFree = capacity ? capacity - slotsUsed : 0;
		return { gfci, afci, twoForty, slotsUsed, slotsFree };
	});

	// Type → badge config maps (same as rooms page)
	const receptacleTypeConfig: Record<string, { label: string; color: string; icon: string }> = {
		'Outlet': { label: 'Outlet', color: 'bg-indigo-500/20 text-indigo-400', icon: 'mdi:power-socket-us' },
		'GFCI Outlet': { label: 'GFCI', color: 'bg-emerald-500/20 text-emerald-400', icon: 'mdi:shield-check' },
		'Smart Switch': { label: 'Smart Switch', color: 'bg-indigo-500/20 text-indigo-400', icon: 'mdi:home-automation' },
		'Dimmer Switch': { label: 'Dimmer', color: 'bg-amber-500/20 text-amber-400', icon: 'mdi:brightness-6' },
		'On/Off Switch': { label: 'Switch', color: 'bg-slate-500/20 text-slate-300', icon: 'mdi:toggle-switch' },
		'On/Off Relay': { label: 'Relay', color: 'bg-cyan-500/20 text-cyan-400', icon: 'mdi:relay' },
		'Timer Switch': { label: 'Timer', color: 'bg-orange-500/20 text-orange-400', icon: 'mdi:timer' },
		'Networking': { label: 'Network', color: 'bg-indigo-500/20 text-indigo-400', icon: 'mdi:ethernet' },
		'Coax': { label: 'Coax', color: 'bg-pink-500/20 text-pink-400', icon: 'mdi:cable-data' },
		'Other': { label: 'Other', color: 'bg-slate-600/30 text-slate-500', icon: 'mdi:help-circle-outline' },
	};
	const loadTypeConfig: Record<string, { label: string; color: string; icon: string }> = {
		'Light - Ceiling': { label: 'Ceiling Light', color: 'bg-amber-500/20 text-amber-300', icon: 'mdi:ceiling-light' },
		'Light - Wall Mounted': { label: 'Wall Light', color: 'bg-amber-500/25 text-amber-400', icon: 'mdi:wall-sconce' },
		'Lamp/Other Light': { label: 'Lamp', color: 'bg-yellow-500/20 text-yellow-400', icon: 'mdi:lamp' },
		'Ceiling Fan/Light': { label: 'Fan/Light', color: 'bg-cyan-500/20 text-cyan-300', icon: 'mdi:ceiling-fan-light' },
		'Camera': { label: 'Camera', color: 'bg-rose-500/20 text-rose-400', icon: 'mdi:cctv' },
		'Camera/Light Combo': { label: 'Cam+Light', color: 'bg-rose-500/20 text-rose-300', icon: 'mdi:camera-plus' },
		'Appliance': { label: 'Appliance', color: 'bg-orange-500/20 text-orange-400', icon: 'mdi:dishwasher' },
		'Electronics': { label: 'Electronics', color: 'bg-indigo-500/20 text-indigo-400', icon: 'mdi:monitor' },
		'Vent Fan': { label: 'Vent Fan', color: 'bg-teal-500/20 text-teal-400', icon: 'mdi:fan' },
	};

	// Build name→record lookup maps for fast type resolution
	const loadByName = $derived.by(() => new Map(allLoads.map((l) => [(l.fields.Name as string) || '', l])));

	// Build circuit→devices maps using actual record relationships
	const recsByCircuitId = $derived.by(() => {
		const map = new Map<number, V3Record[]>();
		for (const r of allReceptacles) {
			const circuitLink = r.fields.Circuit as { id: number } | undefined;
			const circuitId = circuitLink?.id ?? (r.fields.Circuit_id as number | undefined);
			if (circuitId) {
				const arr = map.get(circuitId) || [];
				arr.push(r);
				map.set(circuitId, arr);
			}
		}
		return map;
	});

	const loadsByCircuitId = $derived.by(() => {
		const map = new Map<number, V3Record[]>();
		// Receptacles have Load Name(s) field that links to Load.Name
		// Get loads through receptacles which have Circuit_id
		for (const rec of allReceptacles) {
			const circuitLink = rec.fields.Circuit as { id: number } | undefined;
			const circuitId = circuitLink?.id ?? (rec.fields.Circuit_id as number | undefined);
			if (!circuitId) continue;
			const loadNameField = rec.fields['Load Name(s)'];
			if (!loadNameField) continue;
			const loadNames: string[] = typeof loadNameField === 'string' 
				? loadNameField.split(',').map(s => s.trim()).filter(Boolean)
				: Array.isArray(loadNameField) ? loadNameField.filter(Boolean) : [];
			for (const name of loadNames) {
				const loadRecord = loadByName.get(name);
				if (loadRecord) {
					const arr = map.get(circuitId) || [];
					arr.push(loadRecord);
					map.set(circuitId, arr);
				}
			}
		}
		return map;
	});

	function getCircuitDevices(circuitId: number): { recs: V3Record[]; loads: V3Record[] } {
		return {
			recs: recsByCircuitId.get(circuitId) || [],
			loads: loadsByCircuitId.get(circuitId) || []
		};
	}

	function getLoadBadge(record: V3Record): { label: string; color: string; icon: string } {
		const type = (record.fields['Device Type'] as string) || '';
		return loadTypeConfig[type] || { label: 'Load', color: 'bg-amber-500/20 text-amber-400', icon: 'mdi:lightbulb-outline' };
	}

	function getRecBadge(record: V3Record): { label: string; color: string; icon: string } {
		const recType = (record.fields['Receptacle Type'] as string) || '';
		const features = record.fields.Features as string[] | null;
		if (features?.includes('GFCI') && receptacleTypeConfig['GFCI Outlet']) return receptacleTypeConfig['GFCI Outlet'];
		if (recType && receptacleTypeConfig[recType]) return receptacleTypeConfig[recType];
		return receptacleTypeConfig['Outlet'] || { label: 'Outlet', color: 'bg-indigo-500/20 text-indigo-400', icon: 'mdi:power-socket-us' };
	}

	onMount(() => {
		void (async () => {
			await ensureLoaded();

			panels = [...homeFiltered.panels].sort((a: V3Record, b: V3Record) => {
				const aOrder = (a.fields['Sort Order'] as number) || 99;
				const bOrder = (b.fields['Sort Order'] as number) || 99;
				if (aOrder !== bOrder) return aOrder - bOrder;
				const aType = a.fields['Panel Type'] as string || '';
				const bType = b.fields['Panel Type'] as string || '';
				if (aType === 'Main' && bType !== 'Main') return -1;
				if (bType === 'Main' && aType !== 'Main') return 1;
				return ((b.fields.Capacity as number) || 0) - ((a.fields.Capacity as number) || 0);
			});
			circuits = homeFiltered.circuits;
			allLoads = homeFiltered.loads;
			allReceptacles = homeFiltered.receptacles;
			if (panels.length > 0) {
				selectedPanelId = panels[0].id;
			}
			loading = false;

			loadEnergyMappings();
			connectLiveEnergy();
			handleDeepLinkParams();
		})();

		return () => {
			liveEnergySource?.close();
		};
	});

	// Re-sync when home selection changes (not on every derived re-computation)
	let _prevPanelsHomeId: number | null | undefined = undefined;
	$effect(() => {
		const currentHomeId = homeContext.selectedHomeId;
		if (_prevPanelsHomeId === undefined) {
			// First run — skip, onMount handles initial load
			_prevPanelsHomeId = currentHomeId;
			return;
		}
		if (currentHomeId === _prevPanelsHomeId) return;
		_prevPanelsHomeId = currentHomeId;
		if (!dataStore.loaded || loading) return;
		panels = [...homeFiltered.panels].sort((a: V3Record, b: V3Record) => {
			const aOrder = (a.fields['Sort Order'] as number) || 99;
			const bOrder = (b.fields['Sort Order'] as number) || 99;
			if (aOrder !== bOrder) return aOrder - bOrder;
			const aType = a.fields['Panel Type'] as string || '';
			const bType = b.fields['Panel Type'] as string || '';
			if (aType === 'Main' && bType !== 'Main') return -1;
			if (bType === 'Main' && aType !== 'Main') return 1;
			return ((b.fields.Capacity as number) || 0) - ((a.fields.Capacity as number) || 0);
		});
		circuits = homeFiltered.circuits;
		allLoads = homeFiltered.loads;
		allReceptacles = homeFiltered.receptacles;
		if (panels.length > 0 && !panels.some(p => p.id === selectedPanelId)) {
			selectedPanelId = panels[0].id;
		}
	});

	// React to URL param changes for deep links (fires on client-side navigation too)
	$effect(() => {
		const url = page.url;
		if (!url || typeof window === 'undefined') return;
		handleDeepLinkParams();
	});

	async function handleDeepLinkParams() {
		const urlParams = new URLSearchParams(window.location.search);
		const panelParam = urlParams.get('panel');
		const circuitParam = urlParams.get('circuit');
		const filterParam = urlParams.get('filter');

		const circuitId = circuitParam ? Number.parseInt(circuitParam, 10) : null;
		const linkedCircuit = circuitId !== null && Number.isFinite(circuitId)
			? circuits.find((circuit) => circuit.id === circuitId)
			: undefined;
		const linkedPanelId = (linkedCircuit?.fields.Panel as { id?: number } | undefined)?.id;
		const requestedPanelId = panelParam ? Number.parseInt(panelParam, 10) : linkedPanelId;
		if (requestedPanelId && panels.some((panel) => panel.id === requestedPanelId)) {
			selectedPanelId = requestedPanelId;
		}

		highlightedCircuitId = linkedCircuit?.id ?? null;
		if (circuitParam) {
			expandedCircuit = null;
			await tick();
			await tick();
			setTimeout(() => {
				const el = document.querySelector(`[data-circuit-id="${circuitParam}"]`);
				if (el) {
					el.scrollIntoView({ behavior: 'smooth', block: 'center' });
					el.classList.add('deep-link-flash');
					setTimeout(() => el.classList.remove('deep-link-flash'), 2000);
				}
			}, 300);
		}
		// ?filter=empty — highlight circuits with no loads
		if (filterParam === 'empty') {
			highlightEmptyCircuits = true;
		}
	}

	function getPanelPhoto(panel: V3Record): Attachment | null {
		const attachments = panel.fields.Attachment as Attachment[] | undefined;
		if (attachments && attachments.length > 0) return attachments[0];
		return null;
	}

	// --- Energy Mapping Helpers ---

	async function loadEnergyMappings() {
		try {
			const resp = await fetch('/api/energy/mapping');
			if (!resp.ok) return;
			const data = await resp.json();
			const map = new Map<number, EnergyMapping>();
			for (const c of data.circuits || []) {
				if (c.powerEntityId || c.energyEntityId) {
					map.set(c.id, {
						circuitId: c.id,
						powerEntityId: c.powerEntityId || null,
						energyEntityId: c.energyEntityId || null,
						circuitName: c.name,
						panelName: c.panelName
					});
				}
			}
			energyMappings = map;
			energyMappingsVersion++;
		} catch {
			// Non-critical — energy badges just won't show
		}
	}

	async function saveEnergyMapping(circuitId: number, entityId: string, type: 'power' | 'energy' = 'power') {
		savingMapping = true;
		try {
			if (entityId) {
				await fetch('/api/energy/mapping', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ circuitId, entityId, type })
				});
			} else {
				await fetch(`/api/energy/mapping?circuit_id=${circuitId}&type=${type}`, { method: 'DELETE' });
			}
			await loadEnergyMappings();
		} catch {
			// silently fail
		} finally {
			savingMapping = false;
		}
	}

	function isEnergyMonitored(circuit: V3Record): boolean {
		return Boolean(circuit.fields['Energy Monitored']);
	}

	function getCircuitMapping(circuitId: number): EnergyMapping | undefined {
		void energyMappingsVersion; // reactive dependency
		return energyMappings.get(circuitId);
	}

	function connectLiveEnergy() {
		liveEnergySource?.close();

		try {
			liveEnergySource = new EventSource('/api/energy/live');
			liveEnergySource.addEventListener('power', (event) => {
				try {
					const payload: LiveSSEData = JSON.parse((event as MessageEvent<string>).data);
					const next = new Map<number, number>();
					for (const circuit of payload.circuits) {
						next.set(circuit.circuitId, circuit.watts);
							// Append to sparkline buffer
							const buf = sparklineHistory.get(circuit.circuitId) || [];
							buf.push(circuit.watts);
							if (buf.length > SPARKLINE_MAX) buf.shift();
							sparklineHistory.set(circuit.circuitId, buf);
						}
						liveCircuitWatts = next;
						sparklineHistory = new Map(sparklineHistory);
					} catch {
						// Ignore malformed events.
					}
				});
			liveEnergySource.addEventListener('error', () => {
				liveCircuitWatts = new Map(liveCircuitWatts);
			});
		} catch {
			liveCircuitWatts = new Map();
		}
	}

	function getCircuitLiveWatts(circuitId: number): number | null {
		return liveCircuitWatts.get(circuitId) ?? null;
	}

	function formatCircuitWatts(watts: number): string {
		if (watts >= 1000) return `${(watts / 1000).toFixed(1)}kW`;
		return `${Math.round(watts)}W`;
	}

	type CircuitLoadTier = 'idle' | 'low' | 'medium' | 'high';

	function getCircuitLoadTier(watts: number | null): CircuitLoadTier {
		if (watts == null || watts < 1) return 'idle';
		if (watts < 100) return 'low';
		if (watts < 500) return 'medium';
		return 'high';
	}

	function getCircuitLoadBadgeClass(watts: number | null): string {
		switch (getCircuitLoadTier(watts)) {
			case 'low':
				return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20 live-pulse-low';
			case 'medium':
				return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20 live-pulse-med';
			case 'high':
				return 'bg-red-500/15 text-red-300 ring-1 ring-red-500/20 live-pulse-high';
			default:
				return 'bg-slate-700/70 text-slate-300 ring-1 ring-slate-600/40';
		}
	}

	function getCircuitLoadTileClass(watts: number | null): string {
		switch (getCircuitLoadTier(watts)) {
			case 'low':
				return 'shadow-[inset_0_0_0_1px_rgba(52,211,153,0.18)]';
			case 'medium':
				return 'shadow-[inset_0_0_0_1px_rgba(251,191,36,0.18)]';
			case 'high':
				return 'shadow-[inset_0_0_0_1px_rgba(248,113,113,0.18)]';
			default:
				return 'shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)]';
		}
	}

	async function previewCircuitLabel(circuit: V3Record) {
		const panelName = (selectedPanel?.fields.Name as string) || 'Panel';
		try {
			const configRes = await fetch('/api/settings/printer');
			const config: PrinterConfig = configRes.ok ? await configRes.json() : { tapeWidthMm: 12, labelLengthMm: 40, dpi: 203 } as any;
			const format = (config as any).defaultCircuitFormat || 'compact';
			const template = circuitTemplateFromConfig(config, format);
			const dims = getLabelDimensions(config);
			labelPreviewLabel = renderCircuitLabel(circuit, panelName, template);
			labelPreviewTitle = `${circuit.fields.Number} — ${circuit.fields.Name || 'Circuit'}`;
			labelPreviewWidthMm = dims.widthMm;
			labelPreviewHeightMm = dims.heightMm;
			labelPreviewOpen = true;
		} catch {
			// Fallback if config fetch fails
			const template = circuitTemplateFromConfig({ tapeWidthMm: 12, labelLengthMm: 40, dpi: 203 } as any, 'compact');
			labelPreviewLabel = renderCircuitLabel(circuit, panelName, template);
			labelPreviewTitle = `${circuit.fields.Number} — ${circuit.fields.Name || 'Circuit'}`;
			labelPreviewWidthMm = 40;
			labelPreviewHeightMm = 12;
			labelPreviewOpen = true;
		}
	}

	async function previewQrLabel(circuit: V3Record) {
		const f = circuit.fields;
		try {
			const configRes = await fetch('/api/settings/printer');
			const config: PrinterConfig = configRes.ok ? await configRes.json() : { tapeWidthMm: 12, labelLengthMm: 40 } as any;
			const dims = getLabelDimensions(config);
			const label = await renderQrLabel({
				url: buildCircuitUrl(window.location.origin, selectedPanel!.id, circuit.id),
				line1: (f.Name as string) || 'Circuit',
				line2: `${f.Number} · ${f.Amps || '?'}A${f['GFCI Protected'] || f.GFCI_Protected ? ' · GFCI' : ''}`,
				widthMm: dims.widthMm,
				heightMm: dims.heightMm,
			});
			labelPreviewLabel = label;
			labelPreviewTitle = `QR: ${f.Number} — ${f.Name || 'Circuit'}`;
			labelPreviewOpen = true;
		} catch (e) {
			console.error('QR label render failed:', e);
		}
	}

	function getPanelPhotoUrl(photo: Attachment): string {
		return `/api/image?path=${encodeURIComponent(photo.signedPath)}`;
	}

	// --- Panel Photo Upload ---
	let photoInputEl: HTMLInputElement | undefined = $state(undefined);
	let uploadingPhoto = $state(false);

	function triggerPhotoCapture() {
		photoInputEl?.click();
	}

	async function handlePhotoFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !selectedPanelId) return;

		uploadingPhoto = true;
		try {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('table', 'Panel');
			formData.append('field', 'Attachment');
			formData.append('recordId', String(selectedPanelId));

			const resp = await fetch('/api/upload', { method: 'POST', body: formData });
			if (!resp.ok) {
				const errData = await resp.json().catch(() => null);
				throw new Error(errData?.error || `Upload failed (${resp.status})`);
			}

			const result = await resp.json();
			// Update local panel record with the new attachment
			const panel = panels.find(p => p.id === selectedPanelId);
			if (panel && result.attachment) {
				const existing = (panel.fields.Attachment as Attachment[] | undefined) || [];
				panel.fields.Attachment = [...existing, result.attachment];
			}
			toast.success('Panel photo saved');
		} catch (err) {
			console.error('Photo upload error:', err);
			toast.error(`Failed to upload photo: ${err instanceof Error ? err.message : 'Unknown error'}`);
		} finally {
			uploadingPhoto = false;
			input.value = '';
		}
	}

	function getAmpBadgeColor(amps: number | undefined): string {
		if (!amps) return 'bg-slate-600/80 text-slate-400';
		if (amps >= 50) return 'bg-red-600/90 text-red-100';
		if (amps >= 30) return 'bg-amber-600/90 text-amber-100';
		if (amps >= 20) return 'bg-indigo-600/90 text-indigo-100';
		return 'bg-slate-600/80 text-slate-300';
	}

	function getCircuitNumberColor(amps: number | undefined): string {
		if (!amps) return 'text-slate-500';
		if (amps >= 50) return 'text-red-400';
		if (amps >= 30) return 'text-amber-400';
		if (amps >= 20) return 'text-indigo-400';
		return 'text-slate-400';
	}

	function isGFCI(circuit: V3Record): boolean {
		return !!(circuit.fields['GFCI Protected'] || circuit.fields.GFCI_Protected);
	}

	function getCircuitCounts(circuit: V3Record): { loads: number; recs: number; areas: number } {
		const devices = getCircuitDevices(circuit.id);
		const areaName = circuit.fields['Area Name'];
		let areas = 0;
		if (areaName) {
			if (typeof areaName === 'string' && areaName.trim()) areas = areaName.split(',').length;
			else if (Array.isArray(areaName)) areas = areaName.length;
		}
		return { loads: devices.loads.length, recs: devices.recs.length, areas };
	}

	function isHighlighted(circuit: V3Record): boolean {
		if (!searchQuery.trim()) return false;
		const q = searchQuery.toLowerCase();
		const name = ((circuit.fields.Name as string) || '').toLowerCase();
		const areaField = circuit.fields['Area Name'];
		const area = Array.isArray(areaField) ? areaField.filter(Boolean).join(' ').toLowerCase() : ((areaField as string) || '').toLowerCase();
		const loadArr = circuit.fields['Load Name(s)'];
		const loadStr = Array.isArray(loadArr) ? loadArr.filter(Boolean).join(' ').toLowerCase() : ((loadArr as string) || '').toLowerCase();
		const recArr = circuit.fields['Receptacle Name(s)'];
		const recStr = Array.isArray(recArr) ? recArr.filter(Boolean).join(' ').toLowerCase() : ((recArr as string) || '').toLowerCase();
		return name.includes(q) || area.includes(q) || loadStr.includes(q) || recStr.includes(q);
	}

	// --- Photo Overlay helpers ---

	interface SlotPosition {
		circuit: V3Record;
		side: 'Left' | 'Right';
		slotIndex: number; // 0-based row from top
		poles: number;
		top: number; // percentage
		height: number; // percentage
		left: number; // percentage
		width: number; // percentage
	}

	function inferPoles(circuit: V3Record): number {
		const slot = circuit.fields['Panel Slot'] as string || '';
		// If Panel Slot contains a comma (e.g. "8, 9"), it's double-pole
		if (slot.includes(',')) return 2;
		const amps = circuit.fields.Amps as number || 0;
		// 240V circuits are double-pole (≥30A typically)
		if (amps >= 30) return 2;
		return 1;
	}

	// Detect if a circuit is a tandem (half-height) breaker
	function isTandem(circuit: V3Record): boolean {
		const slot = circuit.fields['Panel Slot'] as string || '';
		return slot.includes('.');
	}

	// Parse tandem slot info: "21.1" → { baseSlot: 21, position: 1 }
	function parseTandemSlot(circuit: V3Record): { baseSlot: number; position: number } | null {
		const slot = circuit.fields['Panel Slot'] as string || '';
		const match = slot.match(/^(\d+)\.(\d+)$/);
		if (match) return { baseSlot: parseInt(match[1]), position: parseInt(match[2]) };
		return null;
	}

	function getSlotPositions(panelCircuits: V3Record[], capacity: number): SlotPosition[] {
		// Calculate actual max row used (not total capacity)
		let maxRow = 0;
		for (const circuit of panelCircuits) {
			const num = circuit.fields.Number as number;
			const poles = inferPoles(circuit);
			const row = Math.ceil(num / 2);
			// Double-pole spans 2 rows
			maxRow = Math.max(maxRow, row + (poles === 2 ? 1 : 0));
		}
		const slotsPerSide = maxRow || Math.ceil(capacity / 2);

		// Use grid offset refinement values
		const gridTop = gridTopPct;
		const gridHeight = gridBottomPct - gridTopPct;
		const slotHeight = gridHeight / slotsPerSide;
		const midpoint = 50;
		const sideWidth = 46;
		const padding = 2;

		return panelCircuits.map(circuit => {
			const num = circuit.fields.Number as number;
			const poles = inferPoles(circuit);
			const tandem = parseTandemSlot(circuit);

			// US standard: odd = Left, even = Right. Row = ceil(num/2).
			const side = num % 2 === 1 ? 'Left' : 'Right';
			const slotIndex = Math.ceil(num / 2) - 1;

			// Tandems are half-height within their slot
			const height = tandem ? slotHeight * 0.5 : slotHeight * poles;
			const topOffset = tandem && tandem.position === 2 ? slotHeight * 0.5 : 0;

			return {
				circuit,
				side: side as 'Left' | 'Right',
				slotIndex,
				poles: tandem ? 0.5 : poles,
				top: gridTop + slotIndex * slotHeight + topOffset,
				height,
				left: side === 'Left' ? padding : midpoint + 2,
				width: sideWidth
			};
		});
	}

	// --- Perspective transform math (no external library) ---
	function solvePerspectiveTransform(
		src: { x: number; y: number }[],
		dst: { x: number; y: number }[]
	): number[] {
		// Solves for 8-parameter perspective transform coefficients
		// Maps src[i] → dst[i] for i=0..3
		// x' = (a*x + b*y + c) / (g*x + h*y + 1)
		// y' = (d*x + e*y + f) / (g*x + h*y + 1)
		// Returns [a, b, c, d, e, f, g, h]
		const A: number[][] = [];
		const B: number[] = [];
		for (let i = 0; i < 4; i++) {
			const { x, y } = src[i];
			const { x: u, y: v } = dst[i];
			A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
			B.push(u);
			A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
			B.push(v);
		}
		return solveLinearSystem(A, B);
	}

	function solveLinearSystem(A: number[][], b: number[]): number[] {
		// Gaussian elimination with partial pivoting
		const n = b.length;
		const aug = A.map((row, i) => [...row, b[i]]);
		for (let col = 0; col < n; col++) {
			let maxRow = col;
			for (let row = col + 1; row < n; row++) {
				if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
			}
			[aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
			const pivot = aug[col][col];
			if (Math.abs(pivot) < 1e-10) return new Array(n).fill(0);
			for (let j = col; j <= n; j++) aug[col][j] /= pivot;
			for (let row = 0; row < n; row++) {
				if (row === col) continue;
				const factor = aug[row][col];
				for (let j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
			}
		}
		return aug.map(row => row[n]);
	}

	function applyTransform(coeffs: number[], x: number, y: number): [number, number] {
		const [a, b, c, d, e, f, g, h] = coeffs;
		const denom = g * x + h * y + 1;
		return [(a * x + b * y + c) / denom, (d * x + e * y + f) / denom];
	}

	async function renderDeskewedImage(imgSrc: string, corners: { x: number; y: number }[], requestId = calibrationLoadVersion) {
		if (corners.length !== 4) return;
		activeDeskewRequestId = requestId;
		deskewing = true;

		try {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error('Failed to load image'));
				img.src = imgSrc;
			});

			// Convert percentage corners to pixel coordinates
			const srcCorners = corners.map(c => ({
				x: (c.x / 100) * img.naturalWidth,
				y: (c.y / 100) * img.naturalHeight
			}));

			// Output dimensions from average quad size
			const topWidth = Math.hypot(srcCorners[1].x - srcCorners[0].x, srcCorners[1].y - srcCorners[0].y);
			const bottomWidth = Math.hypot(srcCorners[2].x - srcCorners[3].x, srcCorners[2].y - srcCorners[3].y);
			const leftHeight = Math.hypot(srcCorners[3].x - srcCorners[0].x, srcCorners[3].y - srcCorners[0].y);
			const rightHeight = Math.hypot(srcCorners[2].x - srcCorners[1].x, srcCorners[2].y - srcCorners[1].y);
			const outW = Math.round((topWidth + bottomWidth) / 2);
			const outH = Math.round((leftHeight + rightHeight) / 2);

			const canvas = document.createElement('canvas');
			canvas.width = outW;
			canvas.height = outH;
			const ctx = canvas.getContext('2d')!;

			// Compute inverse transform: for each output pixel, find source pixel
			// dst corners (output rectangle) → src corners (original image quad)
			const dstPts = [
				{ x: 0, y: 0 },
				{ x: outW, y: 0 },
				{ x: outW, y: outH },
				{ x: 0, y: outH }
			];
			const coeffs = solvePerspectiveTransform(dstPts, srcCorners);

			// Render using triangulated mesh (8x8 grid)
			const gridSize = 8;
			const cellW = outW / gridSize;
			const cellH = outH / gridSize;

			for (let gy = 0; gy < gridSize; gy++) {
				for (let gx = 0; gx < gridSize; gx++) {
					const dstQuad = [
						{ x: gx * cellW, y: gy * cellH },
						{ x: (gx + 1) * cellW, y: gy * cellH },
						{ x: (gx + 1) * cellW, y: (gy + 1) * cellH },
						{ x: gx * cellW, y: (gy + 1) * cellH }
					];
					const srcQuad = dstQuad.map(p => {
						const [sx, sy] = applyTransform(coeffs, p.x, p.y);
						return { x: sx, y: sy };
					});

					drawTexturedTriangle(ctx, img, srcQuad[0], srcQuad[1], srcQuad[2], dstQuad[0], dstQuad[1], dstQuad[2]);
					drawTexturedTriangle(ctx, img, srcQuad[0], srcQuad[2], srcQuad[3], dstQuad[0], dstQuad[2], dstQuad[3]);
				}
			}

			if (requestId !== calibrationLoadVersion) return;
			deskewedDataUrl = canvas.toDataURL('image/jpeg', 0.92);
		} catch (err) {
			console.error('Deskew failed:', err);
			if (requestId === calibrationLoadVersion) {
				deskewedDataUrl = null;
			}
		} finally {
			if (requestId === activeDeskewRequestId) {
				deskewing = false;
			}
		}
	}

	function drawTexturedTriangle(
		ctx: CanvasRenderingContext2D, img: HTMLImageElement,
		s0: { x: number; y: number }, s1: { x: number; y: number }, s2: { x: number; y: number },
		d0: { x: number; y: number }, d1: { x: number; y: number }, d2: { x: number; y: number }
	) {
		ctx.save();
		ctx.beginPath();
		ctx.moveTo(d0.x, d0.y);
		ctx.lineTo(d1.x, d1.y);
		ctx.lineTo(d2.x, d2.y);
		ctx.closePath();
		ctx.clip();

		const denom = (s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y));
		if (Math.abs(denom) < 0.001) { ctx.restore(); return; }

		const m11 = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom;
		const m12 = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom;
		const m13 = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denom;
		const m21 = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom;
		const m22 = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom;
		const m23 = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denom;

		ctx.setTransform(m11, m21, m12, m22, m13, m23);
		ctx.drawImage(img, 0, 0);
		ctx.restore();
	}

	function handlePhotoClick(e: MouseEvent) {
		if (!calibrating) return;
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * 100;
		const y = ((e.clientY - rect.top) / rect.height) * 100;

		if (calibrationStep === 'corners') {
			if (calibrationCorners.length < 4) {
				calibrationCorners = [...calibrationCorners, { x, y }];
				if (calibrationCorners.length === 4) {
					calibrationStep = 'done';
					calibrating = false;
					// Trigger deskew render
					const panel = panels.find(p => p.id === selectedPanelId);
					if (panel) {
						const photo = getPanelPhoto(panel);
						if (photo) {
							const requestId = ++calibrationLoadVersion;
							renderDeskewedImage(getPanelPhotoUrl(photo), calibrationCorners, requestId);
						}
					}
					// Save calibration
					if (selectedPanelId) {
							const config = JSON.stringify({ corners: calibrationCorners, gridTop: gridTopPct, gridBottom: gridBottomPct, version: 4 });
						localStorage.setItem(`panel-overlay-${selectedPanelId}`, config);
							// Save to NocoDB
							fetch('/api/nocodb', {
								method: 'PATCH',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ table: 'Panel', id: selectedPanelId, fields: { Overlay_Config: config } })
							}).catch(() => {});
						}
				}
			}
		}
	}

	function loadSavedCalibration(panelId: number) {
		const requestId = ++calibrationLoadVersion;
		activeDeskewRequestId = 0;
		deskewing = false;
		// Try from panel record first (NocoDB), then localStorage fallback
		const panel = panels.find(p => p.id === panelId);
		const remoteConfig = panel?.fields?.Overlay_Config as string | undefined;
		const saved = remoteConfig || localStorage.getItem(`panel-overlay-${panelId}`);
		if (saved) {
			try {
				const config = JSON.parse(saved);
				const corners = config.corners || [];
				calibrationCorners = corners;
				gridTopPct = config.gridTop ?? 2;
				gridBottomPct = config.gridBottom ?? 98;
				if (corners.length === 4) {
					if (panel) {
						const photo = getPanelPhoto(panel);
						if (photo) {
							renderDeskewedImage(getPanelPhotoUrl(photo), corners, requestId);
						}
					}
				} else {
					deskewedDataUrl = null;
				}
				// Sync localStorage with remote
				if (remoteConfig) {
					localStorage.setItem(`panel-overlay-${panelId}`, remoteConfig);
				}
			} catch {
				calibrationCorners = [];
				deskewedDataUrl = null;
			}
		} else {
			calibrationCorners = [];
			deskewedDataUrl = null;
		}
	}

	function resetCalibration() {
		calibrationLoadVersion++;
		calibrationCorners = [];
		deskewedDataUrl = null;
		calibrationStep = 'corners';
		gridTopPct = 0;
		gridBottomPct = 100;
		refining = false;
		if (selectedPanelId) {
			localStorage.removeItem(`panel-overlay-${selectedPanelId}`);
			// Clear from NocoDB
			fetch('/api/nocodb', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Panel', id: selectedPanelId, fields: { Overlay_Config: null } })
			}).catch(() => {});
		}
	}

	function saveGridOffsets() {
		if (selectedPanelId && calibrationCorners.length === 4) {
			const config = JSON.stringify({ corners: calibrationCorners, gridTop: gridTopPct, gridBottom: gridBottomPct, version: 4 });
			localStorage.setItem(`panel-overlay-${selectedPanelId}`, config);
			fetch('/api/nocodb', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Panel', id: selectedPanelId, fields: { Overlay_Config: config } })
			}).catch(() => {});
		}
	}

	$effect(() => {
		if (!selectedPanelId) return;
		const panelId = selectedPanelId;
		loadSavedCalibration(panelId);
	});
</script>

<!-- Hidden file input for panel photo (camera or library) -->
<input
	type="file"
	accept="image/*"
	bind:this={photoInputEl}
	onchange={handlePhotoFile}
	class="hidden"
/>

<div class="max-w-2xl mx-auto space-y-4">
	<!-- Header -->
	<div class="flex items-center gap-2.5">
		<Icon icon="mdi:transmission-tower" width={22} class="text-amber-400" />
		<h1 class="text-xl font-bold text-fg">Panels</h1>
		{#if isLocked}
			<span class="p-1.5 text-amber-400" title="Home is locked">
				<Icon icon="mdi:lock" width={16} />
			</span>
		{:else}
			<button
				onclick={() => { showCreatePanel = true; }}
				class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
				aria-label="Add panel"
			>
				<Icon icon="mdi:plus" width={18} />
			</button>
		{/if}
	</div>

	{#if loading}
		<!-- Skeleton: panel pills -->
		<div class="flex flex-wrap gap-2">
			<div class="h-7 w-28 rounded-full bg-slate-700/60 animate-pulse"></div>
			<div class="h-7 w-24 rounded-full bg-slate-700/40 animate-pulse"></div>
			<div class="h-7 w-20 rounded-full bg-slate-700/40 animate-pulse"></div>
		</div>
		<!-- Skeleton: panel header -->
		<div class="mt-4 rounded-xl border border-slate-700/50 p-4 bg-slate-800/40 space-y-2">
			<div class="h-5 w-36 rounded bg-slate-700/50 animate-pulse"></div>
			<div class="h-3 w-48 rounded bg-slate-700/30 animate-pulse"></div>
		</div>
		<!-- Skeleton: search bar -->
		<div class="mt-3 h-9 rounded-lg bg-slate-800/50 border border-slate-700/30 animate-pulse"></div>
		<!-- Skeleton: circuit rows -->
		<div class="mt-3 space-y-2">
			{#each Array(8) as _}
				<div class="flex items-center gap-3 bg-slate-800/50 rounded-lg px-3 py-3 border border-slate-700/30">
					<div class="w-7 h-7 rounded bg-slate-700/60 animate-pulse shrink-0"></div>
					<div class="flex-1 space-y-1.5">
						<div class="h-3.5 w-32 rounded bg-slate-700/50 animate-pulse"></div>
						<div class="h-2.5 w-20 rounded bg-slate-700/30 animate-pulse"></div>
					</div>
					<div class="h-5 w-10 rounded bg-slate-700/40 animate-pulse"></div>
				</div>
			{/each}
		</div>
	{:else}
		{#if panels.length === 0}
			<div class="flex flex-col items-center justify-center py-16 gap-4">
				<div class="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center">
					<Icon icon="lucide:square-dot" width={32} class="text-slate-500" />
				</div>
				<div class="text-center">
					<p class="text-slate-300 font-medium">No panels yet</p>
					<p class="text-slate-500 text-sm mt-1">{isLocked ? 'Unlock this home in Settings to add panels' : 'Create your first electrical panel to start mapping circuits'}</p>
				</div>
				{#if !isLocked}
					<button
						onclick={() => { showCreatePanel = true; }}
						class="mt-2 inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-500 transition-background-color active:scale-[0.96]"
					>
						<Icon icon="mdi:plus" width={18} />
						Create Panel
					</button>
				{/if}
			</div>
		{:else}
		<!-- Panel Selector Pills (wrapping, not scrolling) -->
		<div class="flex flex-wrap gap-2">
			{#each panels as panel}
				{@const active = selectedPanelId === panel.id}
				{@const isSubpanel = (panel.fields['Panel Type'] as string || '') !== 'Main'}
				{@const shortName = (panel.fields.Name as string || '').replace(/\s*(Sub\s*)?Panel\s*/i, ' ').trim()}
				<button
					onclick={() => {
						const oldIdx = panels.findIndex(p => p.id === selectedPanelId);
						const newIdx = panels.findIndex(p => p.id === panel.id);
						slideDirection = newIdx > oldIdx ? 'right' : 'left';
						selectedPanelId = panel.id; expandedCircuit = null; highlightedCircuitId = null; searchQuery = ''; viewMode = 'schematic'; calibrating = false;
					}}
					class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-background-color active:scale-[0.96] {active ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20' : 'bg-slate-700/80 text-slate-300 hover:bg-slate-600'}"
				>
					<Icon icon={isSubpanel ? 'lucide:layout-grid' : 'lucide:square-dot'} width={14} />
					{shortName}
				</button>
			{/each}
		</div>

		{#if selectedPanel}
		{#key selectedPanelId}
			<div class="panel-slide-{slideDirection} space-y-4">
			<!-- Panel Info Header (photo as background when available) -->
			{#if getPanelPhoto(selectedPanel)}
				{@const photo = getPanelPhoto(selectedPanel)!}
				<div class="relative rounded-xl overflow-hidden border border-slate-700/50">
					<!-- Background photo (fades in on load to prevent snap) -->
					<img
						src={getPanelPhotoUrl(photo)}
							alt=""
								class="absolute inset-0 w-full h-full object-cover object-center opacity-0 transition-opacity duration-500 ease-out"
						draggable="false"
							onload={(e) => { e.currentTarget.classList.remove('opacity-0'); }}
						/>
					<!-- Dark overlay for legibility -->
					<div class="absolute inset-0 bg-gradient-to-r from-slate-900/90 via-slate-900/80 to-slate-900/60"></div>
					<!-- Content -->
					<div class="relative p-4">
						<div class="flex items-start justify-between">
							<div>
								<h2 class="text-lg font-bold text-white drop-shadow-sm">{selectedPanel.fields.Name}</h2>
								<p class="text-xs text-slate-300 mt-0.5">
									{selectedPanel.fields.Location || ''}{selectedPanel.fields.Location ? ' · ' : ''}{panelCircuits.length} circuits{#if selectedPanel.fields['Service Size']} <span class="text-slate-500 mx-1">|</span> {selectedPanel.fields['Service Size']}A{/if}{#if selectedPanel.fields.Capacity} <span class="text-slate-500 mx-1">|</span> {selectedPanel.fields.Capacity} slots{#if panelStats.slotsFree > 0} · {panelStats.slotsFree} free{/if}{/if}
								</p>
							</div>
							<div class="flex items-center gap-2">
								<button
										type="button"
										onclick={triggerPhotoCapture}
										disabled={uploadingPhoto}
										class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/40 backdrop-blur-sm border border-white/10 text-[11px] font-medium text-slate-300 hover:text-white active:scale-[0.96] transition-all duration-150 disabled:opacity-50"
										title="Replace Panel Photo"
									>
										<Icon icon={uploadingPhoto ? 'mdi:loading' : 'mdi:camera-flip'} width={13} class={uploadingPhoto ? 'animate-spin' : ''} />
										<span class="hidden sm:inline">Retake</span>
									</button>
								<button
										type="button"
										onclick={() => { showLabelPrint = !showLabelPrint; }}
										class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/40 backdrop-blur-sm border border-white/10 text-[11px] font-medium {showLabelPrint ? 'bg-indigo-600 text-white shadow-sm border-indigo-500/50' : 'text-slate-300 hover:text-white'} active:scale-[0.96] transition-all duration-150"
										title="Print Labels"
									>
										<Icon icon="mdi:printer" width={13} />
										<span class="hidden sm:inline">Labels</span>
									</button>
								<div class="inline-flex rounded-lg bg-black/40 backdrop-blur-sm border border-white/10 p-0.5">
									<button
										onclick={() => { viewMode = 'schematic'; }}
										class="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium {viewMode === 'schematic' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-300 hover:text-white'}"
									>
										<Icon icon="mdi:view-grid-outline" width={13} />
										<span class="hidden sm:inline">Schematic</span>
									</button>
									<button
										onclick={() => { viewMode = 'photo'; }}
										class="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium {viewMode === 'photo' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-300 hover:text-white'}"
									>
										<Icon icon="mdi:image-outline" width={13} />
										<span class="hidden sm:inline">Photo</span>
									</button>
										<button
											onclick={() => { showARView = true; }}
											class="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-300 hover:text-white"
										>
											<Icon icon="mdi:augmented-reality" width={13} />
											<span class="hidden sm:inline">AR</span>
										</button>
								</div>
							</div>
						</div>
						<!-- Stats badges -->
						{#if panelStats.gfci || panelStats.afci || panelStats.twoForty}
							<div class="flex gap-3 mt-2.5">
								{#if panelStats.gfci}
									<span class="flex items-center gap-1 text-[11px] text-slate-300">
										<span class="w-2.5 h-2.5 rounded-full bg-green-500"></span> GFCI ({panelStats.gfci})
									</span>
								{/if}
								{#if panelStats.afci}
									<span class="flex items-center gap-1 text-[11px] text-slate-300">
										<span class="w-2.5 h-2.5 rounded-full bg-indigo-500"></span> AFCI ({panelStats.afci})
									</span>
								{/if}
								{#if panelStats.twoForty}
									<span class="flex items-center gap-1 text-[11px] text-slate-300">
										<span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span> 240V ({panelStats.twoForty})
									</span>
								{/if}
							</div>
						{/if}
						{#if showLabelPrint}
							<div class="mt-3 pt-3 border-t border-white/10">
								<PanelLabelActions panel={selectedPanel} circuits={panelCircuits} receptacles={allReceptacles} areas={homeFiltered.areas} onpreview={(label, title, w, h) => { labelPreviewLabel = label; labelPreviewTitle = title; labelPreviewWidthMm = w ?? 40; labelPreviewHeightMm = h ?? 12; labelPreviewOpen = true; }} />
							</div>
						{/if}
					</div>
				</div>
			{:else}
				<!-- No photo: plain header -->
				<div class="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
					<div class="flex items-start justify-between">
						<div>
							<h2 class="text-lg font-bold text-white">{selectedPanel.fields.Name}</h2>
							<p class="text-xs text-slate-400 mt-0.5">
								{selectedPanel.fields.Location || ''}{selectedPanel.fields.Location ? ' · ' : ''}{panelCircuits.length} circuits{#if selectedPanel.fields['Service Size']} <span class="text-slate-600 mx-1">|</span> {selectedPanel.fields['Service Size']}A{/if}{#if selectedPanel.fields.Capacity} <span class="text-slate-600 mx-1">|</span> {selectedPanel.fields.Capacity} slots{#if panelStats.slotsFree > 0} · {panelStats.slotsFree} free{/if}{/if}
							</p>
						</div>
							<div class="flex items-center gap-1.5">
								<button
									type="button"
									onclick={triggerPhotoCapture}
									disabled={uploadingPhoto}
									class="p-2 rounded-lg bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white active:scale-[0.96] transition-colors duration-150 disabled:opacity-50"
									title="Take Panel Photo"
								>
									<Icon icon={uploadingPhoto ? 'mdi:loading' : 'mdi:camera-plus'} width={18} class={uploadingPhoto ? 'animate-spin' : ''} />
								</button>
								<button
									type="button"
									onclick={() => { showLabelPrint = !showLabelPrint; }}
									class="p-2 rounded-lg bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white active:scale-[0.96] transition-colors duration-150"
									title="Print Labels"
								>
									<Icon icon="mdi:printer" width={18} />
								</button>
							</div>
						</div>
					{#if panelStats.gfci || panelStats.afci || panelStats.twoForty}
						<div class="flex gap-3 mt-2.5">
							{#if panelStats.gfci}
								<span class="flex items-center gap-1 text-[11px] text-slate-400">
									<span class="w-2.5 h-2.5 rounded-full bg-green-500"></span> GFCI ({panelStats.gfci})
								</span>
							{/if}
							{#if panelStats.afci}
								<span class="flex items-center gap-1 text-[11px] text-slate-400">
									<span class="w-2.5 h-2.5 rounded-full bg-indigo-500"></span> AFCI ({panelStats.afci})
								</span>
							{/if}
							{#if panelStats.twoForty}
								<span class="flex items-center gap-1 text-[11px] text-slate-400">
									<span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span> 240V ({panelStats.twoForty})
								</span>
							{/if}
						</div>
					{/if}
					{#if showLabelPrint}
						<div class="mt-3 pt-3 border-t border-slate-700/50">
							<PanelLabelActions panel={selectedPanel} circuits={panelCircuits} receptacles={allReceptacles} areas={homeFiltered.areas} onpreview={(label, title, w, h) => { labelPreviewLabel = label; labelPreviewTitle = title; labelPreviewWidthMm = w ?? 40; labelPreviewHeightMm = h ?? 12; labelPreviewOpen = true; }} />
						</div>
					{/if}
				</div>
			{/if}

			<!-- Panel Photo (if exists) -->
			{#if getPanelPhoto(selectedPanel)}
				{@const photo = getPanelPhoto(selectedPanel)!}

				{#if viewMode === 'photo'}
						<!-- Search bar above photo -->
						<div class="relative mb-2">
							<Icon icon="mdi:magnify" width={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
							<input
								type="text"
								bind:value={searchQuery}
								placeholder="Highlight a circuit…"
								class="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg pl-9 pr-8 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-border-color"
							/>
							{#if searchQuery.trim()}
								<button
									onclick={() => { searchQuery = ''; }}
									class="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-slate-500 hover:text-white hover:bg-slate-600 transition-color,background-color"
								>
									<Icon icon="mdi:close" width={14} />
								</button>
							{/if}
						</div>
						<!-- Photo Overlay View -->
						<div class="relative rounded-xl {refining ? '' : 'overflow-hidden'} border border-slate-700/50 shadow-lg shadow-black/20 bg-slate-900">
						<!-- Calibration toolbar (only shown during calibration or before first calibration) -->
						{#if calibrating || !deskewedDataUrl}
						<div class="flex items-center justify-between px-3 py-2 bg-slate-800/90 border-b border-slate-700/50">
							<span class="text-[11px] text-slate-400">
								{#if deskewing}
									<span class="flex items-center gap-1 text-indigo-400">
										<Icon icon="mdi:loading" width={12} class="animate-spin" /> Deskewing…
									</span>
								{:else if calibrating}
									Tap the 4 corners of the panel face ({calibrationCorners.length}/4)
								{:else}
									Calibrate to deskew and overlay
								{/if}
							</span>
							<div class="flex items-center gap-1.5">
								{#if calibrating}
									<button
										onclick={() => { calibrating = false; calibrationCorners = []; calibrationStep = 'corners'; }}
										class="text-[11px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 active:scale-[0.96]"
									>
										Cancel
									</button>
								{:else}
									<button
										onclick={() => { calibrating = true; calibrationCorners = []; calibrationStep = 'corners'; }}
										class="text-[11px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 active:scale-[0.96]"
									>
										Calibrate
									</button>
								{/if}
							</div>
						</div>
						{/if}

						<!-- Photo with overlay -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="relative select-none"
							style="cursor: {calibrating ? 'crosshair' : 'default'}"
							onclick={calibrating ? handlePhotoClick : undefined}
						>
							<!-- Floating controls overlay (top-right, only after deskew) -->
							{#if deskewedDataUrl && !calibrating}
								<div class="absolute top-1.5 right-1.5 z-30 flex items-center gap-1">
									{#if refining}
										<!-- Done refining button (prominent) -->
										<button
											onclick={() => { refining = false; saveGridOffsets(); }}
											class="px-2.5 py-1 rounded-lg bg-green-600/90 backdrop-blur-md border border-green-400/30 text-white text-[11px] font-semibold hover:bg-green-500/90 active:scale-[0.96] transition-colors"
										>
											✓ Done
										</button>
									{:else}
										<!-- Label toggle -->
										<button
											onclick={() => { showOverlayLabels = !showOverlayLabels; }}
											class="p-1.5 rounded-lg bg-slate-900/60 backdrop-blur-md border border-white/10 {showOverlayLabels ? 'text-indigo-400' : 'text-white/50'} hover:bg-slate-900/80 hover:text-white active:scale-[0.96] transition-colors"
											title="{showOverlayLabels ? 'Hide' : 'Show'} labels"
										>
											<Icon icon={showOverlayLabels ? 'mdi:tag' : 'mdi:tag-off-outline'} width={15} />
										</button>
									{/if}
									<!-- Overflow menu -->
									<div class="relative">
										<button
											onclick={() => { showCalibrationMenu = !showCalibrationMenu; }}
											class="p-1.5 rounded-lg bg-slate-900/60 backdrop-blur-md border border-white/10 text-white/80 hover:bg-slate-900/80 hover:text-white active:scale-[0.96] transition-colors"
											title="More options"
										>
											<Icon icon="mdi:dots-horizontal" width={15} />
										</button>
										{#if showCalibrationMenu}
											<!-- svelte-ignore a11y_click_events_have_key_events -->
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<div
												class="fixed inset-0 z-40"
												onclick={() => { showCalibrationMenu = false; }}
											></div>
											<div class="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl shadow-black/40 py-1 min-w-[140px]">
												<button
													onclick={(e) => { e.stopPropagation(); showCalibrationMenu = false; calibrating = true; calibrationCorners = []; calibrationStep = 'corners'; }}
													class="w-full text-left text-xs px-3 py-1.5 text-slate-300 hover:bg-slate-700 flex items-center gap-2"
												>
													<Icon icon="mdi:crosshairs" width={14} />
													Recalibrate
												</button>
												<button
													onclick={(e) => { e.stopPropagation(); showCalibrationMenu = false; refining = !refining; }}
													class="w-full text-left text-xs px-3 py-1.5 text-slate-300 hover:bg-slate-700 flex items-center gap-2"
												>
													<Icon icon="mdi:tune-vertical" width={14} />
													{refining ? 'Done refining' : 'Refine grid'}
												</button>
												<button
													onclick={(e) => { e.stopPropagation(); showCalibrationMenu = false; resetCalibration(); }}
													class="w-full text-left text-xs px-3 py-1.5 text-red-400 hover:bg-slate-700 flex items-center gap-2"
												>
													<Icon icon="mdi:delete-outline" width={14} />
													Reset calibration
												</button>
											</div>
										{/if}
									</div>
								</div>
							{/if}
							{#if deskewedDataUrl && !calibrating}
								<!-- Deskewed image -->
								<div class="relative" style="{refining ? 'overflow: visible' : ''}">
									<img
										src={deskewedDataUrl}
										alt="{selectedPanel.fields.Name} deskewed"
										class="w-full"
										draggable="false"
									/>
									<!-- Refinement guide lines (draggable) -->
									{#if refining}
										<!-- Top guide -->
										<div
											class="absolute left-0 right-0 h-[3px] bg-green-400 cursor-ns-resize z-20 group"
											style="top: {gridTopPct}%"
											onpointerdown={(e) => {
												const el = (e.currentTarget as HTMLElement).parentElement!;
												const rect = el.getBoundingClientRect();
												const moveHandler = (ev: PointerEvent) => {
													const pct = Math.max(0, Math.min(gridBottomPct - 5, ((ev.clientY - rect.top) / rect.height) * 100));
													gridTopPct = Math.round(pct * 10) / 10;
												};
												const upHandler = () => {
													document.removeEventListener('pointermove', moveHandler);
													document.removeEventListener('pointerup', upHandler);
													saveGridOffsets();
												};
												document.addEventListener('pointermove', moveHandler);
												document.addEventListener('pointerup', upHandler);
												(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
											}}
										>
											<span class="absolute left-1 -top-4 text-[10px] font-bold text-green-400 bg-black/60 px-1 rounded">TOP {gridTopPct.toFixed(1)}%</span>
										</div>
										<!-- Bottom guide -->
										<div
											class="absolute left-0 right-0 h-[3px] bg-red-400 cursor-ns-resize z-20 group"
											style="top: {gridBottomPct}%"
											onpointerdown={(e) => {
												const el = (e.currentTarget as HTMLElement).parentElement!;
												const rect = el.getBoundingClientRect();
												const moveHandler = (ev: PointerEvent) => {
													const pct = Math.max(gridTopPct + 5, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
													gridBottomPct = Math.round(pct * 10) / 10;
												};
												const upHandler = () => {
													document.removeEventListener('pointermove', moveHandler);
													document.removeEventListener('pointerup', upHandler);
													saveGridOffsets();
												};
												document.addEventListener('pointermove', moveHandler);
												document.addEventListener('pointerup', upHandler);
												(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
											}}
										>
											<span class="absolute left-1 top-1 text-[10px] font-bold text-red-400 bg-black/60 px-1 rounded">BOTTOM {gridBottomPct.toFixed(1)}%</span>
										</div>
									{/if}
									<!-- Breaker slot overlays on deskewed image -->
									{#each getSlotPositions(panelCircuits, (selectedPanel.fields.Capacity as number) || 42) as slot}
										{@const isActive = expandedCircuit === slot.circuit.id}
										{@const isDeepLinked = highlightedCircuitId === slot.circuit.id}
										{@const highlighted = searchQuery.trim() && isHighlighted(slot.circuit)}
										<button
											data-circuit-id={slot.circuit.id}
											onclick={(e) => { e.stopPropagation(); expandedCircuit = isActive ? null : slot.circuit.id; }}
											class="absolute rounded-sm border group {isActive ? 'bg-indigo-500/30 border-indigo-400/80 z-10' : isDeepLinked ? 'bg-cyan-400/25 border-cyan-300 ring-2 ring-cyan-300/70 z-10' : highlighted ? 'bg-indigo-400/20 border-indigo-400/50' : 'border-slate-400/20 hover:bg-indigo-500/20 hover:border-indigo-400/60'}"
											style="left: {slot.left}%; top: {slot.top}%; width: {slot.width}%; height: {slot.height}%"
											title="#{slot.circuit.fields.Number} - {slot.circuit.fields.Name || 'Unnamed'} ({slot.circuit.fields.Amps}A)"
										>
											{#if showOverlayLabels || isActive || isDeepLinked}
												<span class="absolute inset-0 flex flex-col {slot.side === 'Right' ? 'items-end text-right' : 'items-start text-left'} justify-center px-2 py-0.5 overflow-hidden" style="font-variant-numeric: tabular-nums; background: linear-gradient({slot.side === 'Right' ? 'to left' : 'to right'}, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)">
													<span class="text-xs font-bold text-white leading-tight">{parseTandemSlot(slot.circuit) ? slot.circuit.fields['Panel Slot'] : slot.circuit.fields.Number}</span>
													<span class="text-[11px] font-medium text-white/90 leading-tight truncate max-w-full">{slot.circuit.fields.Name || ''}</span>
													<span class="text-[10px] text-white/70 leading-tight">{slot.circuit.fields.Amps}A{inferPoles(slot.circuit) === 2 ? ' · 240V' : ''}</span>
												</span>
											{:else}
												<span class="absolute inset-0 flex flex-col {slot.side === 'Right' ? 'items-end text-right' : 'items-start text-left'} justify-center px-2 py-0.5 overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity" style="font-variant-numeric: tabular-nums; background: linear-gradient({slot.side === 'Right' ? 'to left' : 'to right'}, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)">
													<span class="text-xs font-bold text-white leading-tight">{parseTandemSlot(slot.circuit) ? slot.circuit.fields['Panel Slot'] : slot.circuit.fields.Number}</span>
													<span class="text-[11px] font-medium text-white/90 leading-tight truncate max-w-full">{slot.circuit.fields.Name || ''}</span>
													<span class="text-[10px] text-white/70 leading-tight">{slot.circuit.fields.Amps}A{inferPoles(slot.circuit) === 2 ? ' · 240V' : ''}</span>
												</span>
											{/if}
										</button>
									{/each}
									<!-- Expanded detail popover for selected circuit -->
									{#if expandedCircuit}
										{@const activeSlot = getSlotPositions(panelCircuits, (selectedPanel.fields.Capacity as number) || 42).find(s => s.circuit.id === expandedCircuit)}
										{#if activeSlot}
											{@const f = activeSlot.circuit.fields}
											{@const devices = getCircuitDevices(activeSlot.circuit.id)}
											<!-- svelte-ignore a11y_click_events_have_key_events -->
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<div
												class="absolute z-30 {activeSlot.side === 'Right' ? 'right-1' : 'left-1'} w-[48%] bg-slate-900/95 backdrop-blur-md border border-slate-600/60 rounded-lg shadow-xl shadow-black/50 p-2.5 text-xs space-y-1.5"
												style="top: {Math.min(activeSlot.top + activeSlot.height, 75)}%"
												onclick={(e) => e.stopPropagation()}
											>
												<div class="flex items-center justify-between">
													<div class="flex items-center gap-1.5">
														<span class="text-sm font-bold text-white" style="font-variant-numeric: tabular-nums">#{parseTandemSlot(activeSlot.circuit) ? f['Panel Slot'] : f.Number}</span>
														{#if isGFCI(activeSlot.circuit)}
															<span class="text-[9px] px-1 py-0 rounded bg-green-500/20 text-green-400 font-medium">GFCI</span>
														{/if}
														{#if inferPoles(activeSlot.circuit) === 2}
															<span class="text-[9px] px-1 py-0 rounded bg-amber-500/20 text-amber-400 font-medium">240V</span>
														{/if}
													</div>
													<span class="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold {getAmpBadgeColor(f.Amps as number)}" style="font-variant-numeric: tabular-nums">{f.Amps || '?'}A</span>
												</div>
												<p class="text-[11px] font-medium text-white">{f.Name || 'Unnamed'}</p>
												{#if f['Area Name']}
													<p class="text-slate-400 flex items-center gap-1"><Icon icon="mdi:map-marker" width={11} class="text-indigo-400" /> {f['Area Name']}</p>
												{/if}
												{#if devices.loads.length > 0}
													<div>
														<p class="text-slate-500 text-[9px] uppercase tracking-wide mb-0.5">Loads ({devices.loads.length})</p>
														<ul class="space-y-0.5">
															{#each devices.loads.slice(0, 4) as load}
																<li class="text-slate-300 text-[11px] truncate">• {getDisplayName(load)}</li>
															{/each}
															{#if devices.loads.length > 4}
																<li class="text-slate-500 text-[10px]">+{devices.loads.length - 4} more</li>
															{/if}
														</ul>
													</div>
												{/if}
												{#if devices.recs.length > 0}
													<div>
														<p class="text-slate-500 text-[9px] uppercase tracking-wide mb-0.5">Receptacles ({devices.recs.length})</p>
														<ul class="space-y-0.5">
															{#each devices.recs.slice(0, 3) as rec}
																<li class="text-slate-300 text-[11px] truncate">• {getDisplayName(rec)}</li>
															{/each}
															{#if devices.recs.length > 3}
																<li class="text-slate-500 text-[10px]">+{devices.recs.length - 3} more</li>
															{/if}
														</ul>
													</div>
												{/if}
												{#if f.Notes}
													<p class="text-slate-400 italic text-[10px]">{f.Notes}</p>
												{/if}
											</div>
										{/if}
									{/if}
								</div>
							{:else}
								<!-- Raw photo (for calibration or before deskew) -->
								<img
									src={getPanelPhotoUrl(photo)}
									alt="{selectedPanel.fields.Name} photo"
									class="w-full"
									draggable="false"
								/>

								<!-- Calibration corner markers -->
								{#if calibrating && calibrationCorners.length > 0}
									{#each calibrationCorners as corner, i}
										<div
											class="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-indigo-500 border-2 border-white shadow-lg"
											style="left: {corner.x}%; top: {corner.y}%"
										>
											<span class="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] text-white font-bold bg-indigo-600 rounded px-1">{i + 1}</span>
										</div>
									{/each}
									<!-- Connection lines between corners -->
									{#if calibrationCorners.length >= 2}
										<svg class="absolute inset-0 w-full h-full pointer-events-none">
											{#each calibrationCorners as corner, i}
												{#if i > 0}
													<line
														x1="{calibrationCorners[i-1].x}%" y1="{calibrationCorners[i-1].y}%"
														x2="{corner.x}%" y2="{corner.y}%"
														stroke="rgb(59 130 246)" stroke-width="2" stroke-dasharray="4"
													/>
												{/if}
											{/each}
											{#if calibrationCorners.length === 4}
												<line
													x1="{calibrationCorners[3].x}%" y1="{calibrationCorners[3].y}%"
													x2="{calibrationCorners[0].x}%" y2="{calibrationCorners[0].y}%"
													stroke="rgb(59 130 246)" stroke-width="2" stroke-dasharray="4"
												/>
											{/if}
										</svg>
									{/if}
								{/if}
							{/if}
						</div>

						<!-- Expanded circuit detail below photo -->
						{#if expandedCircuit}
							{@const circuit = panelCircuits.find(c => c.id === expandedCircuit)}
							{#if circuit}
								{@const f = circuit.fields}
								{@const devices = getCircuitDevices(circuit.id)}
									{@const mapping = getCircuitMapping(circuit.id)}
									<div transition:slide={{ duration: 200, easing: cubicOut }} class="px-3 py-3 border-t border-slate-700/50 bg-slate-800/90 space-y-2">
										<div class="flex items-center justify-between">
											<div class="flex items-center gap-2">
												<span class="text-sm font-bold {getCircuitNumberColor(f.Amps as number)}" style="font-variant-numeric: tabular-nums">#{f.Number}</span>
												<span class="text-sm font-medium text-white">{f.Name || 'Unnamed'}</span>
												{#if isEnergyMonitored(circuit)}
													<span title="Energy Monitored"><Icon icon="mdi:flash" width={14} class="text-emerald-400" /></span>
												{/if}
											</div>
											<div class="flex items-center gap-1.5">
												<span class="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold {getAmpBadgeColor(f.Amps as number)}" style="font-variant-numeric: tabular-nums">{f.Amps || '?'}A</span>
												{#if isGFCI(circuit)}
													<span class="w-2 h-2 rounded-full bg-green-500" title="GFCI"></span>
												{/if}
												<button
													onclick={() => expandedCircuit = null}
													class="p-0.5 rounded text-slate-500 hover:text-white hover:bg-slate-700 transition-color,background-color"
												>
													<Icon icon="mdi:close" width={14} />
												</button>
											</div>
										</div>
										{#if f['Area Name']}
											<p class="text-xs text-slate-400 flex items-center gap-1"><Icon icon="mdi:map-marker" width={12} class="text-indigo-400" /> {f['Area Name']}</p>
										{/if}
										{#if isEnergyMonitored(circuit)}
											<div class="text-xs">
												<p class="text-slate-500 text-[10px] uppercase tracking-wide mb-1.5">Energy Monitoring</p>
													<div class="space-y-2">
														<div>
															<p class="text-[9px] text-slate-500 mb-0.5">Power (live W)</p>
															<EntityPicker
																value={mapping?.powerEntityId || ''}
																onselect={(entityId) => saveEnergyMapping(circuit.id, entityId, 'power')}
																placeholder="Select power sensor…"
																deviceClass="power"
																disabled={savingMapping}
															/>
														</div>
														<div>
															<p class="text-[9px] text-slate-500 mb-0.5">Energy (daily kWh)</p>
															<EntityPicker
																value={mapping?.energyEntityId || ''}
																onselect={(entityId) => saveEnergyMapping(circuit.id, entityId, 'energy')}
																placeholder="Select energy sensor…"
																deviceClass="energy"
																disabled={savingMapping}
															/>
														</div>
													</div>
												</div>
											{/if}
									{#if devices.recs.length > 0}
										<div class="text-xs">
											<p class="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Receptacles</p>
											<ul class="space-y-0.5">
												{#each devices.recs as rec}
													{@const badge = getRecBadge(rec)}
													<li class="flex items-center gap-1.5 py-0.5">
														<Icon icon={badge.icon} width={12} class="{badge.color.split(' ')[1]} shrink-0" />
														<span class="text-slate-300 truncate">{getDisplayName(rec)}</span>
														<span class="text-[9px] px-1 py-0 rounded {badge.color} ml-auto shrink-0">{badge.label}</span>
													</li>
												{/each}
											</ul>
										</div>
									{/if}
									{#if devices.loads.length > 0}
										<div class="text-xs">
											<p class="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Loads</p>
											<ul class="space-y-0.5">
												{#each devices.loads as load}
													{@const badge = getLoadBadge(load)}
													<li class="flex items-center gap-1.5 py-0.5">
														<Icon icon={badge.icon} width={12} class="{badge.color.split(' ')[1]} shrink-0" />
														<span class="text-slate-300 truncate">{getDisplayName(load)}</span>
														<span class="text-[9px] px-1 py-0 rounded {badge.color} ml-auto shrink-0">{badge.label}</span>
													</li>
												{/each}
											</ul>
										</div>
									{/if}
									{#if f.Notes}
										<p class="text-xs text-slate-400 italic">{f.Notes}</p>
									{/if}
								</div>
							{/if}
						{/if}
					</div>
				{/if}
			{/if}

			{#if viewMode === 'schematic' || !getPanelPhoto(selectedPanel)}
				<!-- Search + Add Circuit -->
				<div class="flex items-center gap-2">
					<div class="relative flex-1">
						<Icon icon="mdi:magnify" width={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
						<input
							type="text"
							bind:value={searchQuery}
							placeholder="Find a circuit…"
							class="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg pl-9 pr-8 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-border-color"
						/>
						{#if searchQuery.trim()}
							<button
								onclick={() => { searchQuery = ''; }}
								class="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-slate-500 hover:text-white hover:bg-slate-600 transition-color,background-color"
							>
								<Icon icon="mdi:close" width={14} />
							</button>
						{/if}
					</div>
					{#if !isLocked}
						<button
							onclick={() => { showCreateCircuit = true; }}
							class="shrink-0 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 border border-slate-700/60 transition-colors"
							aria-label="Add circuit"
							title="Add circuit"
						>
							<Icon icon="mdi:plus" width={16} />
						</button>
					{/if}
				</div>
			{#if searchQuery.trim()}
				<p class="text-[11px] text-slate-500 px-1">{filteredCircuits.length} of {panelCircuits.length} circuits</p>
			{/if}

			<!-- Circuit Grid (side-by-side columns) -->
				<div class="grid grid-cols-2 gap-2">
					<!-- Left Column -->
					<div class="space-y-1.5">
							{#each leftRows as row}
								{#if row.type === 'tandem'}
									<!-- Tandem pair: two half-height circuits in one card -->
									{@const tandemExpanded = row.circuits.some(c => expandedCircuit === c.id)}
									{@const tandemHighlighted = row.circuits.some(c => highlightedCircuitId === c.id)}
									<div class="rounded-lg bg-slate-800/80 border overflow-hidden {tandemExpanded ? 'border-indigo-500/60' : tandemHighlighted ? 'border-cyan-400 ring-2 ring-cyan-400/60' : 'border-amber-600/30'}">
										{#each row.circuits as circuit, ci}
											{@const f = circuit.fields}
											{@const amps = f.Amps as number | undefined}
											{@const isExpanded = expandedCircuit === circuit.id}
											{@const isDeepLinked = highlightedCircuitId === circuit.id}
											{@const displayNum = f['Panel Slot'] || f.Number}
											{@const liveWatts = getCircuitLiveWatts(circuit.id)}
											{@const showLiveBadge = isEnergyMonitored(circuit) || getCircuitMapping(circuit.id)?.powerEntityId}
											<button
												data-circuit-id={circuit.id}
												onclick={() => expandedCircuit = isExpanded ? null : circuit.id}
												class="w-full text-left px-2.5 py-1.5 active:scale-[0.98] {ci > 0 ? 'border-t border-dashed border-slate-700/50' : ''} {isDeepLinked ? 'bg-cyan-500/15' : ''} {showLiveBadge ? getCircuitLoadTileClass(liveWatts) : ''}"
											>
												<div class="flex items-center justify-between gap-1">
													<div class="min-w-0 flex-1 flex items-center gap-1.5">
														<span class="text-[10px] font-bold {getCircuitNumberColor(amps)}" style="font-variant-numeric: tabular-nums">{displayNum}</span>
														<p class="text-[11px] font-medium text-white truncate">{f.Name || 'Unnamed'}</p>
													</div>
													<div class="flex items-center gap-1">
														{#if showLiveBadge}
															<span class={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${getCircuitLoadBadgeClass(liveWatts)}`} style="font-variant-numeric: tabular-nums">
																{liveWatts == null ? '? Mapped' : formatCircuitWatts(liveWatts)}
															</span>
														{/if}
														<span class="text-[9px] px-1 py-0 rounded font-mono font-bold shrink-0 {getAmpBadgeColor(amps)}" style="font-variant-numeric: tabular-nums">{amps || '?'}A</span>
													</div>
												</div>
											</button>
											{#if isExpanded}
												{@const devices = getCircuitDevices(circuit.id)}
												{@const sparkData = sparklineHistory.get(circuit.id)}
												<div transition:slide={{ duration: 200, easing: cubicOut }} class="px-2.5 pb-2 text-xs space-y-1.5 border-t border-slate-700/40 pt-1.5">
													{#if sparkData && sparkData.length >= 3}
														<div class="flex items-center gap-2">
															<span class="text-[10px] text-slate-500">Trend</span>
															<Sparkline values={sparkData} width={80} height={16} color={!liveWatts || liveWatts < 1 ? '#64748b' : getCircuitLoadTier(liveWatts) === 'high' ? '#f87171' : getCircuitLoadTier(liveWatts) === 'medium' ? '#fbbf24' : '#34d399'} />
														</div>
													{/if}
													{#if f['Area Name']}
														<p class="text-slate-400 flex items-center gap-1"><Icon icon="mdi:map-marker" width={11} class="text-indigo-400" /> {f['Area Name']}</p>
													{/if}
													{#if f.Notes}
														<p class="text-slate-400 italic">{f.Notes}</p>
													{/if}
												</div>
											{/if}
										{/each}
									</div>
								{:else}
									<!-- Single or Double-pole -->
									{@const circuit = row.circuits[0]}
									{@const f = circuit.fields}
									{@const amps = f.Amps as number | undefined}
									{@const highlighted = searchQuery.trim() && isHighlighted(circuit)}
									{@const counts = getCircuitCounts(circuit)}
									{@const isExpanded = expandedCircuit === circuit.id}
									{@const isDeepLinked = highlightedCircuitId === circuit.id}
									{@const isEmpty = highlightEmptyCircuits && counts.loads === 0 && counts.recs === 0}
									{@const liveWatts = getCircuitLiveWatts(circuit.id)}
									{@const showLiveBadge = isEnergyMonitored(circuit) || getCircuitMapping(circuit.id)?.powerEntityId}
									<div
										data-circuit-id={circuit.id}
										class="rounded-lg bg-slate-800/80 border transition-border-color {isExpanded ? 'border-indigo-500/60' : isDeepLinked ? 'border-cyan-400 ring-2 ring-cyan-400/60 bg-cyan-950/20' : row.type === 'double' ? 'border-amber-600/40' : 'border-slate-700/50 hover:border-slate-600'} {highlighted ? 'ring-1 ring-indigo-400' : ''} {isEmpty ? 'ring-1 ring-amber-400/60 bg-amber-950/10' : ''} {showLiveBadge ? getCircuitLoadTileClass(liveWatts) : ''}"
									>
										<button
											onclick={() => expandedCircuit = isExpanded ? null : circuit.id}
											class="w-full text-left p-2.5 active:scale-[0.97]"
										>
											<div class="flex items-start justify-between gap-1">
												<div class="min-w-0 flex-1">
													<div class="flex items-center gap-1.5">
														<span class="text-sm font-bold {getCircuitNumberColor(amps)}" style="font-variant-numeric: tabular-nums">{f.Number}</span>
														{#if isGFCI(circuit)}
															<span class="w-2 h-2 rounded-full bg-green-500 shrink-0" title="GFCI Protected"></span>
														{/if}
														{#if row.type === 'double'}
															<span class="text-[9px] px-1 py-0 rounded bg-amber-500/20 text-amber-400 font-medium">240V</span>
														{/if}
													</div>
													<p class="text-xs font-medium text-white mt-0.5 truncate">{f.Name || 'Unnamed'}</p>
													{#if !isExpanded && (counts.loads > 0 || counts.recs > 0 || counts.areas > 0)}
														<div class="flex items-center gap-2 mt-0.5">
															{#if counts.areas > 0}
																<span class="text-[10px] text-indigo-400/80 flex items-center gap-0.5" style="font-variant-numeric: tabular-nums">
																	<Icon icon="mdi:floor-plan" width={11} class="text-indigo-400" />{counts.areas}
																</span>
															{/if}
															{#if counts.recs > 0}
																<span class="text-[10px] text-indigo-400/80 flex items-center gap-0.5" style="font-variant-numeric: tabular-nums">
																	<Icon icon="mdi:power-socket-us" width={11} class="text-indigo-400" />{counts.recs}
																</span>
															{/if}
															{#if counts.loads > 0}
																<span class="text-[10px] text-amber-400/80 flex items-center gap-0.5" style="font-variant-numeric: tabular-nums">
																	<Icon icon="mdi:lightbulb-outline" width={11} class="text-amber-400" />{counts.loads}
																</span>
															{/if}
														</div>
													{/if}
												</div>
												<div class="flex flex-col items-end gap-1">
													{#if showLiveBadge}
														<span class={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${getCircuitLoadBadgeClass(liveWatts)}`} style="font-variant-numeric: tabular-nums">
															{liveWatts == null ? '? Mapped' : formatCircuitWatts(liveWatts)}
														</span>
													{/if}
													<span class="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold shrink-0 {getAmpBadgeColor(amps)}" style="font-variant-numeric: tabular-nums">
														{amps || '?'}A
													</span>
												</div>
											</div>
										</button>
									{#if isExpanded}
										{@const devices = getCircuitDevices(circuit.id)}
										{@const mapping = getCircuitMapping(circuit.id)}
										{@const sparkData = sparklineHistory.get(circuit.id)}
										<div transition:slide={{ duration: 200, easing: cubicOut }} class="px-2.5 pb-2.5 text-xs space-y-2 border-t border-slate-700/40 pt-2">
											{#if sparkData && sparkData.length >= 3}
												<div class="stagger-item flex items-center gap-2" style="animation-delay: 100ms">
													<span class="text-[10px] text-slate-500">Trend</span>
													<Sparkline values={sparkData} width={100} height={18} color={!liveWatts || liveWatts < 1 ? '#64748b' : getCircuitLoadTier(liveWatts) === 'high' ? '#f87171' : getCircuitLoadTier(liveWatts) === 'medium' ? '#fbbf24' : '#34d399'} />
												</div>
											{/if}
											{#if f['Area Name']}
												<p class="stagger-item text-slate-400 flex items-center gap-1" style="animation-delay: 150ms"><Icon icon="mdi:map-marker" width={12} class="text-indigo-400" /> {f['Area Name']}</p>
											{/if}
											{#if isEnergyMonitored(circuit)}
												<div class="stagger-item" style="animation-delay: 175ms">
													<p class="text-slate-500 text-[10px] uppercase tracking-wide mb-1.5">Energy Monitoring</p>
													<div class="space-y-2">
														<div>
															<p class="text-[9px] text-slate-500 mb-0.5">Power (live W)</p>
															<EntityPicker
																value={mapping?.powerEntityId || ''}
																onselect={(entityId) => saveEnergyMapping(circuit.id, entityId, 'power')}
																placeholder="Select power sensor…"
																deviceClass="power"
																disabled={savingMapping}
															/>
														</div>
														<div>
															<p class="text-[9px] text-slate-500 mb-0.5">Energy (daily kWh)</p>
															<EntityPicker
																value={mapping?.energyEntityId || ''}
																onselect={(entityId) => saveEnergyMapping(circuit.id, entityId, 'energy')}
																placeholder="Select energy sensor…"
																deviceClass="energy"
																disabled={savingMapping}
															/>
														</div>
													</div>
												</div>
											{/if}
											{#if devices.recs.length > 0}
												<div class="stagger-item" style="animation-delay: 200ms">
													<p class="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Receptacles</p>
													<ul class="space-y-0.5">
														{#each devices.recs as rec, i}
															{@const badge = getRecBadge(rec)}
															<li class="stagger-item flex items-center gap-1.5 py-0.5" style="animation-delay: {250 + i * 50}ms">
																<Icon icon={badge.icon} width={12} class="{badge.color.split(' ')[1]} shrink-0" />
																<span class="text-slate-300 truncate">{getDisplayName(rec)}</span>
																<span class="text-[9px] px-1 py-0 rounded {badge.color} ml-auto shrink-0">{badge.label}</span>
															</li>
														{/each}
													</ul>
												</div>
											{/if}
											{#if devices.loads.length > 0}
												<div class="stagger-item" style="animation-delay: 300ms">
													<p class="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Loads</p>
													<ul class="space-y-0.5">
														{#each devices.loads as load, i}
															{@const badge = getLoadBadge(load)}
															<li class="stagger-item flex items-center gap-1.5 py-0.5" style="animation-delay: {350 + i * 50}ms">
																<Icon icon={badge.icon} width={12} class="{badge.color.split(' ')[1]} shrink-0" />
																<span class="text-slate-300 truncate">{getDisplayName(load)}</span>
																<span class="text-[9px] px-1 py-0 rounded {badge.color} ml-auto shrink-0">{badge.label}</span>
															</li>
														{/each}
													</ul>
												</div>
											{/if}
											{#if f.Notes}
												<p class="stagger-item text-slate-400 italic mt-1" style="animation-delay: 400ms">{f.Notes}</p>
											{/if}
											<div class="stagger-item flex items-center gap-2 mt-2" style="animation-delay: 450ms">
												<button
													type="button"
													onclick={(e) => { e.stopPropagation(); previewCircuitLabel(circuit); }}
													class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-700/60 text-slate-300 text-[11px] font-medium hover:bg-slate-600 hover:text-white active:scale-[0.96] transition-colors"
												>
													<Icon icon="mdi:printer" width={12} />
													Print Label
												</button>
												<button
													type="button"
													onclick={(e) => { e.stopPropagation(); previewQrLabel(circuit); }}
													class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-700/60 text-indigo-300 text-[11px] font-medium hover:bg-indigo-900/40 hover:text-indigo-200 active:scale-[0.96] transition-colors"
												>
													<Icon icon="mdi:qrcode" width={12} />
													QR Label
												</button>
											</div>
										</div>
									{/if}
									</div>
								{/if}
							{/each}
						</div>

						<!-- Right Column -->
						<div class="space-y-1.5">
							{#each rightRows as row}
								{#if row.type === 'tandem'}
									<!-- Tandem pair -->
									{@const tandemExpanded = row.circuits.some(c => expandedCircuit === c.id)}
									{@const tandemHighlighted = row.circuits.some(c => highlightedCircuitId === c.id)}
									<div class="rounded-lg bg-slate-800/80 border overflow-hidden {tandemExpanded ? 'border-indigo-500/60' : tandemHighlighted ? 'border-cyan-400 ring-2 ring-cyan-400/60' : 'border-amber-600/30'}">
										{#each row.circuits as circuit, ci}
											{@const f = circuit.fields}
											{@const amps = f.Amps as number | undefined}
											{@const isExpanded = expandedCircuit === circuit.id}
											{@const isDeepLinked = highlightedCircuitId === circuit.id}
											{@const displayNum = f['Panel Slot'] || f.Number}
											{@const liveWatts = getCircuitLiveWatts(circuit.id)}
											{@const showLiveBadge = isEnergyMonitored(circuit) || getCircuitMapping(circuit.id)?.powerEntityId}
											<button
												data-circuit-id={circuit.id}
												onclick={() => expandedCircuit = isExpanded ? null : circuit.id}
												class="w-full text-left px-2.5 py-1.5 active:scale-[0.98] {ci > 0 ? 'border-t border-dashed border-slate-700/50' : ''} {isDeepLinked ? 'bg-cyan-500/15' : ''} {showLiveBadge ? getCircuitLoadTileClass(liveWatts) : ''}"
											>
												<div class="flex items-center justify-between gap-1">
													<div class="min-w-0 flex-1 flex items-center gap-1.5">
														<span class="text-[10px] font-bold {getCircuitNumberColor(amps)}" style="font-variant-numeric: tabular-nums">{displayNum}</span>
														<p class="text-[11px] font-medium text-white truncate">{f.Name || 'Unnamed'}</p>
													</div>
													<div class="flex items-center gap-1">
														{#if showLiveBadge}
															<span class={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${getCircuitLoadBadgeClass(liveWatts)}`} style="font-variant-numeric: tabular-nums">
																{liveWatts == null ? '? Mapped' : formatCircuitWatts(liveWatts)}
															</span>
														{/if}
														<span class="text-[9px] px-1 py-0 rounded font-mono font-bold shrink-0 {getAmpBadgeColor(amps)}" style="font-variant-numeric: tabular-nums">{amps || '?'}A</span>
													</div>
												</div>
											</button>
											{#if isExpanded}
												{@const devices = getCircuitDevices(circuit.id)}
												{@const sparkData = sparklineHistory.get(circuit.id)}
												<div transition:slide={{ duration: 200, easing: cubicOut }} class="px-2.5 pb-2 text-xs space-y-1.5 border-t border-slate-700/40 pt-1.5">
													{#if sparkData && sparkData.length >= 3}
														<div class="flex items-center gap-2">
															<span class="text-[10px] text-slate-500">Trend</span>
															<Sparkline values={sparkData} width={80} height={16} color={!liveWatts || liveWatts < 1 ? '#64748b' : getCircuitLoadTier(liveWatts) === 'high' ? '#f87171' : getCircuitLoadTier(liveWatts) === 'medium' ? '#fbbf24' : '#34d399'} />
														</div>
													{/if}
													{#if f['Area Name']}
														<p class="text-slate-400 flex items-center gap-1"><Icon icon="mdi:map-marker" width={11} class="text-indigo-400" /> {f['Area Name']}</p>
													{/if}
													{#if f.Notes}
														<p class="text-slate-400 italic">{f.Notes}</p>
													{/if}
												</div>
											{/if}
										{/each}
									</div>
								{:else}
									<!-- Single or Double-pole -->
									{@const circuit = row.circuits[0]}
									{@const f = circuit.fields}
									{@const amps = f.Amps as number | undefined}
									{@const highlighted = searchQuery.trim() && isHighlighted(circuit)}
									{@const counts = getCircuitCounts(circuit)}
									{@const isExpanded = expandedCircuit === circuit.id}
									{@const isDeepLinked = highlightedCircuitId === circuit.id}
									{@const isEmpty = highlightEmptyCircuits && counts.loads === 0 && counts.recs === 0}
									{@const liveWatts = getCircuitLiveWatts(circuit.id)}
									{@const showLiveBadge = isEnergyMonitored(circuit) || getCircuitMapping(circuit.id)?.powerEntityId}
									<div
										data-circuit-id={circuit.id}
										class="rounded-lg bg-slate-800/80 border transition-border-color {isExpanded ? 'border-indigo-500/60' : isDeepLinked ? 'border-cyan-400 ring-2 ring-cyan-400/60 bg-cyan-950/20' : row.type === 'double' ? 'border-amber-600/40' : 'border-slate-700/50 hover:border-slate-600'} {highlighted ? 'ring-1 ring-indigo-400' : ''} {isEmpty ? 'ring-1 ring-amber-400/60 bg-amber-950/10' : ''} {showLiveBadge ? getCircuitLoadTileClass(liveWatts) : ''}"
									>
										<button
											onclick={() => expandedCircuit = isExpanded ? null : circuit.id}
											class="w-full text-left p-2.5 active:scale-[0.97]"
										>
											<div class="flex items-start justify-between gap-1">
												<div class="min-w-0 flex-1">
													<div class="flex items-center gap-1.5">
														<span class="text-sm font-bold {getCircuitNumberColor(amps)}" style="font-variant-numeric: tabular-nums">{f.Number}</span>
														{#if isGFCI(circuit)}
															<span class="w-2 h-2 rounded-full bg-green-500 shrink-0" title="GFCI Protected"></span>
														{/if}
														{#if row.type === 'double'}
															<span class="text-[9px] px-1 py-0 rounded bg-amber-500/20 text-amber-400 font-medium">240V</span>
														{/if}
													</div>
													<p class="text-xs font-medium text-white mt-0.5 truncate">{f.Name || 'Unnamed'}</p>
													{#if !isExpanded && (counts.loads > 0 || counts.recs > 0 || counts.areas > 0)}
														<div class="flex items-center gap-2 mt-0.5">
															{#if counts.areas > 0}
																<span class="text-[10px] text-indigo-400/80 flex items-center gap-0.5" style="font-variant-numeric: tabular-nums">
																	<Icon icon="mdi:floor-plan" width={11} class="text-indigo-400" />{counts.areas}
																</span>
															{/if}
															{#if counts.recs > 0}
																<span class="text-[10px] text-indigo-400/80 flex items-center gap-0.5" style="font-variant-numeric: tabular-nums">
																	<Icon icon="mdi:power-socket-us" width={11} class="text-indigo-400" />{counts.recs}
																</span>
															{/if}
															{#if counts.loads > 0}
																<span class="text-[10px] text-amber-400/80 flex items-center gap-0.5" style="font-variant-numeric: tabular-nums">
																	<Icon icon="mdi:lightbulb-outline" width={11} class="text-amber-400" />{counts.loads}
																</span>
															{/if}
														</div>
													{/if}
												</div>
												<div class="flex flex-col items-end gap-1">
													{#if showLiveBadge}
														<span class={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${getCircuitLoadBadgeClass(liveWatts)}`} style="font-variant-numeric: tabular-nums">
															{liveWatts == null ? '? Mapped' : formatCircuitWatts(liveWatts)}
														</span>
													{/if}
													<span class="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold shrink-0 {getAmpBadgeColor(amps)}" style="font-variant-numeric: tabular-nums">
														{amps || '?'}A
													</span>
												</div>
											</div>
										</button>
									{#if isExpanded}
										{@const devices = getCircuitDevices(circuit.id)}
										{@const mapping = getCircuitMapping(circuit.id)}
										{@const sparkData = sparklineHistory.get(circuit.id)}
										<div transition:slide={{ duration: 200, easing: cubicOut }} class="px-2.5 pb-2.5 text-xs space-y-2 border-t border-slate-700/40 pt-2">
											{#if sparkData && sparkData.length >= 3}
												<div class="stagger-item flex items-center gap-2" style="animation-delay: 100ms">
													<span class="text-[10px] text-slate-500">Trend</span>
													<Sparkline values={sparkData} width={100} height={18} color={!liveWatts || liveWatts < 1 ? '#64748b' : getCircuitLoadTier(liveWatts) === 'high' ? '#f87171' : getCircuitLoadTier(liveWatts) === 'medium' ? '#fbbf24' : '#34d399'} />
												</div>
											{/if}
											{#if f['Area Name']}
												<p class="stagger-item text-slate-400 flex items-center gap-1" style="animation-delay: 150ms"><Icon icon="mdi:map-marker" width={12} class="text-indigo-400" /> {f['Area Name']}</p>
											{/if}
											{#if isEnergyMonitored(circuit)}
												<div class="stagger-item" style="animation-delay: 175ms">
													<p class="text-slate-500 text-[10px] uppercase tracking-wide mb-1.5">Energy Monitoring</p>
													<div class="space-y-2">
														<div>
															<p class="text-[9px] text-slate-500 mb-0.5">Power (live W)</p>
															<EntityPicker
																value={mapping?.powerEntityId || ''}
																onselect={(entityId) => saveEnergyMapping(circuit.id, entityId, 'power')}
																placeholder="Select power sensor…"
																deviceClass="power"
																disabled={savingMapping}
															/>
														</div>
														<div>
															<p class="text-[9px] text-slate-500 mb-0.5">Energy (daily kWh)</p>
															<EntityPicker
																value={mapping?.energyEntityId || ''}
																onselect={(entityId) => saveEnergyMapping(circuit.id, entityId, 'energy')}
																placeholder="Select energy sensor…"
																deviceClass="energy"
																disabled={savingMapping}
															/>
														</div>
													</div>
												</div>
											{/if}
											{#if devices.recs.length > 0}
												<div class="stagger-item" style="animation-delay: 200ms">
													<p class="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Receptacles</p>
													<ul class="space-y-0.5">
														{#each devices.recs as rec, i}
															{@const badge = getRecBadge(rec)}
															<li class="stagger-item flex items-center gap-1.5 py-0.5" style="animation-delay: {250 + i * 50}ms">
																<Icon icon={badge.icon} width={12} class="{badge.color.split(' ')[1]} shrink-0" />
																<span class="text-slate-300 truncate">{getDisplayName(rec)}</span>
																<span class="text-[9px] px-1 py-0 rounded {badge.color} ml-auto shrink-0">{badge.label}</span>
															</li>
														{/each}
													</ul>
												</div>
											{/if}
											{#if devices.loads.length > 0}
												<div class="stagger-item" style="animation-delay: 300ms">
													<p class="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Loads</p>
													<ul class="space-y-0.5">
														{#each devices.loads as load, i}
															{@const badge = getLoadBadge(load)}
															<li class="stagger-item flex items-center gap-1.5 py-0.5" style="animation-delay: {350 + i * 50}ms">
																<Icon icon={badge.icon} width={12} class="{badge.color.split(' ')[1]} shrink-0" />
																<span class="text-slate-300 truncate">{getDisplayName(load)}</span>
																<span class="text-[9px] px-1 py-0 rounded {badge.color} ml-auto shrink-0">{badge.label}</span>
															</li>
														{/each}
													</ul>
												</div>
											{/if}
											{#if f.Notes}
												<p class="stagger-item text-slate-400 italic mt-1" style="animation-delay: 400ms">{f.Notes}</p>
											{/if}
											<div class="stagger-item flex items-center gap-2 mt-2" style="animation-delay: 450ms">
												<button
													type="button"
													onclick={(e) => { e.stopPropagation(); previewCircuitLabel(circuit); }}
													class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-700/60 text-slate-300 text-[11px] font-medium hover:bg-slate-600 hover:text-white active:scale-[0.96] transition-colors"
												>
													<Icon icon="mdi:printer" width={12} />
													Print Label
												</button>
												<button
													type="button"
													onclick={(e) => { e.stopPropagation(); previewQrLabel(circuit); }}
													class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-700/60 text-indigo-300 text-[11px] font-medium hover:bg-indigo-900/40 hover:text-indigo-200 active:scale-[0.96] transition-colors"
												>
													<Icon icon="mdi:qrcode" width={12} />
													QR Label
												</button>
											</div>
										</div>
									{/if}
									</div>
								{/if}
							{/each}
						</div>
					</div>

			<!-- Legend -->
			<div class="flex flex-wrap gap-3 text-[11px] text-slate-400 px-1 pt-1">
				<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-green-500"></span> GFCI</span>
				<span class="flex items-center gap-1.5"><Icon icon="mdi:flash" width={12} class="text-emerald-400" /> Energy</span>
				<span class="flex items-center gap-1.5"><span class="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-slate-600/80 text-slate-300">15A</span></span>
				<span class="flex items-center gap-1.5"><span class="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-indigo-600/90 text-indigo-100">20A</span></span>
				<span class="flex items-center gap-1.5"><span class="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-amber-600/90 text-amber-100">30A</span></span>
				<span class="flex items-center gap-1.5"><span class="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-red-600/90 text-red-100">50A+</span></span>
			</div>
			{/if}
			</div>
		{/key}
		{/if}
		{/if}
	{/if}
</div>

<!-- AR View fullscreen overlay -->
{#if showARView && selectedPanel}
	<PanelARView
		panel={selectedPanel}
		circuits={circuits}
		loads={allLoads}
		receptacles={allReceptacles}
		onClose={() => { showARView = false; }}
	/>
{/if}

<!-- Page-level Label Preview Modal (rendered outside overflow containers) -->
<LabelPreview
	bind:open={labelPreviewOpen}
	label={labelPreviewLabel}
	title={labelPreviewTitle}
	labelWidthMm={labelPreviewWidthMm}
	labelHeightMm={labelPreviewHeightMm}
/>

<!-- Create Panel Modal -->
{#if showCreatePanel}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onclick={() => { showCreatePanel = false; }}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[90vw] max-w-sm p-5" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-base font-semibold text-white mb-4">Create Panel</h3>
			<div class="space-y-3">
				<div>
					<label for="new-panel-name" class="text-xs text-slate-400 block mb-1">Panel Name</label>
					<input
						id="new-panel-name"
						type="text"
						bind:value={newPanelName}
						placeholder="e.g. Main Panel"
						class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-border-color"
						onkeydown={(e) => { if (e.key === 'Enter' && newPanelName.trim()) createPanel(); }}
					/>
				</div>
				<div>
					<label for="new-panel-type" class="text-xs text-slate-400 block mb-1">Type</label>
					<select
						id="new-panel-type"
						bind:value={newPanelType}
						class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-border-color"
					>
						<option value="Main">Main Panel</option>
						<option value="Sub">Sub Panel</option>
					</select>
				</div>
				<div>
					<label for="new-panel-spaces" class="text-xs text-slate-400 block mb-1">Total Spaces (optional)</label>
					<input
						id="new-panel-spaces"
						type="number"
						bind:value={newPanelSpaces}
						placeholder="e.g. 40"
						class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-border-color"
					/>
				</div>
			</div>
			<div class="flex gap-2 mt-5">
				<button
					onclick={() => { showCreatePanel = false; }}
					class="flex-1 px-4 py-2.5 bg-slate-700 text-slate-300 text-sm font-medium rounded-lg hover:bg-slate-600 transition-background-color"
				>Cancel</button>
				<button
					onclick={() => createPanel()}
					disabled={!newPanelName.trim() || creatingPanel}
					class="flex-1 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-500 transition-background-color disabled:opacity-50 active:scale-[0.96]"
				>{creatingPanel ? 'Creating…' : 'Create'}</button>
			</div>
		</div>
	</div>
{/if}

<!-- Create Circuit Modal -->
{#if showCreateCircuit}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onclick={() => { showCreateCircuit = false; }}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[90vw] max-w-sm p-5" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-base font-semibold text-white mb-4">Add Circuit</h3>
			<div class="space-y-3">
				<div>
					<label for="new-circuit-name" class="text-xs text-slate-400 block mb-1">Circuit Name</label>
					<input
						id="new-circuit-name"
						type="text"
						bind:value={newCircuitName}
						placeholder="e.g. Kitchen Outlets"
						class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-border-color"
						onkeydown={(e) => { if (e.key === 'Enter' && newCircuitName.trim()) createCircuit(); }}
					/>
				</div>
				<div class="grid grid-cols-3 gap-2">
					<div>
						<label for="new-circuit-number" class="text-xs text-slate-400 block mb-1">Slot #</label>
						<input
							id="new-circuit-number"
							type="number"
							bind:value={newCircuitNumber}
							placeholder="1"
							class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-border-color"
						/>
					</div>
					<div>
						<label for="new-circuit-amps" class="text-xs text-slate-400 block mb-1">Amps</label>
						<select
							id="new-circuit-amps"
							bind:value={newCircuitAmps}
							class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-border-color"
						>
							<option value="15">15A</option>
							<option value="20">20A</option>
							<option value="30">30A</option>
							<option value="40">40A</option>
							<option value="50">50A</option>
							<option value="60">60A</option>
							<option value="100">100A</option>
							<option value="200">200A</option>
						</select>
					</div>
					<div>
						<label for="new-circuit-voltage" class="text-xs text-slate-400 block mb-1">Voltage</label>
						<select
							id="new-circuit-voltage"
							bind:value={newCircuitVoltage}
							class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-border-color"
						>
							<option value="120V">120V</option>
							<option value="240V">240V</option>
						</select>
					</div>
				</div>
			</div>
			<div class="flex gap-2 mt-5">
				<button
					onclick={() => { showCreateCircuit = false; }}
					class="flex-1 px-4 py-2.5 bg-slate-700 text-slate-300 text-sm font-medium rounded-lg hover:bg-slate-600 transition-background-color"
				>Cancel</button>
				<button
					onclick={() => createCircuit()}
					disabled={!newCircuitName.trim() || creatingCircuit}
					class="flex-1 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-500 transition-background-color disabled:opacity-50 active:scale-[0.96]"
				>{creatingCircuit ? 'Adding…' : 'Add'}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	:global(.live-pulse-low) {
		animation: pulse-low 2.5s ease-in-out infinite;
	}
	:global(.live-pulse-med) {
		animation: pulse-med 1.8s ease-in-out infinite;
	}
	:global(.live-pulse-high) {
		animation: pulse-high 1.2s ease-in-out infinite;
	}

	@keyframes pulse-low {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.7; }
	}
	@keyframes pulse-med {
		0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(251, 191, 36, 0); }
		50% { opacity: 0.85; box-shadow: 0 0 6px 1px rgba(251, 191, 36, 0.25); }
	}
	@keyframes pulse-high {
		0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(248, 113, 113, 0); }
		50% { opacity: 0.9; box-shadow: 0 0 8px 2px rgba(248, 113, 113, 0.35); }
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.live-pulse-low),
		:global(.live-pulse-med),
		:global(.live-pulse-high) {
			animation: none;
		}
	}
</style>
