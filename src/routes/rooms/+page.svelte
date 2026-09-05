<script lang="ts">
	import { onMount } from 'svelte';
	import { slide, fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { page } from '$app/state';
	import DynamicIcon from '$lib/components/DynamicIcon.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import QuickAddLoad from '$lib/components/QuickAddLoad.svelte';
	import type { SavedLoad } from '$lib/components/QuickAddLoad.svelte';
	import QuickAddReceptacle from '$lib/components/QuickAddReceptacle.svelte';
	import type { SavedReceptacle } from '$lib/components/QuickAddReceptacle.svelte';
	import LoadEditForm from '$lib/components/LoadEditForm.svelte';
	import Icon from '@iconify/svelte';
	import { toast } from 'svelte-sonner';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { getDisplayName, getFullName } from '$lib/utils/display-name';
	import { tooltip } from '$lib/actions/tooltip';
	import {
		loadTypeConfig,
		receptacleTypeConfig,
		networkRoleOptions,
		powerSourceOptions,
		type V3Record
	} from '$lib/config/device-types';

	import { dataStore, ensureLoaded, invalidate } from '$lib/stores/data.svelte';
	import { homeFiltered, homeContext } from '$lib/stores/home-context.svelte';

	interface Attachment {
		path: string;
		title: string;
		mimetype: string;
		signedPath: string;
	}

	let areas: V3Record[] = $state([]);
	let allLoads: V3Record[] = $state([]);
	let allReceptacles: V3Record[] = $state([]);
	let allCircuits: V3Record[] = $state([]);
	let allPanels: V3Record[] = $state([]);
	let loading = $state(true);
	const isLocked = $derived(homeContext.isLocked);
	let deviceFilter: 'all' | 'receptacles' | 'loads' = $state('all');

	// View mode: list (default) or floorplan
	let viewMode: 'list' | 'floorplan' = $state('list');
	let floorplans: V3Record[] = $state([]);
	let selectedFloorId: number | null = $state(null);
	let floorSlideDirection = $state(1); // 1 = forward/right, -1 = backward/left
	let uploading = $state(false);
	let editingMarkers = $state(false);
	let placingItem: { type: 'room' | 'load' | 'receptacle' | 'panel'; id?: number; areaId?: number } | null = $state(null);
	let placingFixture: { loadId: number; fixtureIndex: number; total: number } | null = $state(null);
	let draggingFixture: { loadId: number; fixtureIndex: number; startX: number; startY: number } | null = $state(null);
	let dragFixturePos: { x: number; y: number } | null = $state(null);
	let floorplanScale = $state(1);
	let floorplanTranslate = $state({ x: 0, y: 0 });
	let isPanning = $state(false);
	// Counter-scale: markers grow at 50% of zoom rate to prevent overwhelming at high zoom
	// At 2× zoom markers are ~1.41×, at 3× zoom ~1.73×. On mobile, base is 85%.
	let isMobileView = $state(false);
	const markerCounterScale = $derived((isMobileView ? 0.82 : 1) / Math.pow(floorplanScale, 0.5));
	let markerTick = $state(0); // bump to force re-clustering
	let mergeTargetKey: string | null = $state(null); // cluster key that would receive a placed/dragged marker
	let renamingFloorId: number | null = $state(null);
	let renameFloorValue = $state('');
	let showFloorMenu: number | null = $state(null);
	let visibleLayers = $state({ rooms: true, loads: true, receptacles: true, panels: true });
	let invertFloorplan = $state(false);
	let clusterStyle = $state<'dots' | 'gradient'>('dots');
	let searchQuery = $state('');
	let viewLayer: 'power' | 'network' = $state('power');
	let viewLayerReady = $state(false);

	// Fullscreen floorplan state
	let isFullscreen = $state(false);
	let floorplanContainerEl: HTMLDivElement | null = $state(null);

	async function toggleFullscreen() {
		if (!floorplanContainerEl) return;

		// If we're in CSS-only fullscreen (iOS PWA), just toggle the flag
		const nativeFullscreenEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
		if (isFullscreen && !nativeFullscreenEl) {
			isFullscreen = false;
			document.body.style.overflow = '';
			return;
		}

		try {
			if (!nativeFullscreenEl) {
				if (floorplanContainerEl.requestFullscreen) {
					await floorplanContainerEl.requestFullscreen();
				} else if ((floorplanContainerEl as any).webkitRequestFullscreen) {
					(floorplanContainerEl as any).webkitRequestFullscreen();
				} else {
					// No Fullscreen API (iOS PWA) — use CSS fallback
					isFullscreen = true;
					document.body.style.overflow = 'hidden';
				}
			} else {
				if (document.exitFullscreen) {
					await document.exitFullscreen();
				} else if ((document as any).webkitExitFullscreen) {
					(document as any).webkitExitFullscreen();
				}
			}
		} catch (err) {
			// Fallback for environments that reject the request
			isFullscreen = !isFullscreen;
			document.body.style.overflow = isFullscreen ? 'hidden' : '';
		}
	}

	// Sync state with browser fullscreen changes (including native Escape)
	function onFullscreenChange() {
		const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
		isFullscreen = fsEl === floorplanContainerEl;
		if (!isFullscreen) {
			document.body.style.overflow = '';
		}
		// Try to unlock screen orientation when entering fullscreen (for iOS/Android rotation)
		if (isFullscreen && 'screen' in window && 'orientation' in screen) {
			try {
				(screen.orientation as any).unlock?.();
			} catch (_) { /* ignore — not all browsers support this */ }
		}
	}

	// Advanced type filters: null means "show all", Set means "show only these types"
	let loadTypeFilter: Set<string> | null = $state(null);
	let receptacleTypeFilter: Set<string> | null = $state(null);
	// Attribute filters
	let filterPermanentOnly = $state(false);
	// Dropdown open states
	let loadFilterOpen = $state(false);
	let recFilterOpen = $state(false);

	// Confirm dialog state
	let confirmDialog = $state({ open: false, title: '', description: '', variant: 'danger' as 'danger' | 'warning' | 'default', onConfirm: () => {} });

	// Comments state
	interface Comment { id: string; comment: string; created_by_email: string; created_at: string; }
	let comments: Comment[] = $state([]);
	let commentsLoading = $state(false);
	let newComment = $state('');
	let addingComment = $state(false);
	let commentCounts: Record<number, number | null> = $state({}); // null = not yet loaded

	// Quick Add state
	let showQuickAdd = $state(false);
	let showQuickAddReceptacle = $state(false);
	let quickAddAreaId: number | undefined = $state(undefined);
	let addMenuAreaId: number | null = $state(null);

	// Close add menu on click outside
	$effect(() => {
		if (addMenuAreaId === null) return;
		function handleClick() { addMenuAreaId = null; }
		// Delay to avoid catching the opening click
		const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
		return () => { clearTimeout(timer); document.removeEventListener('click', handleClick); };
	});

	// Close filter dropdowns on click outside
	$effect(() => {
		if (!loadFilterOpen && !recFilterOpen) return;
		function handleClick() { loadFilterOpen = false; recFilterOpen = false; }
		const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
		return () => { clearTimeout(timer); document.removeEventListener('click', handleClick); };
	});

	// Editing state
	let editingArea: V3Record | null = $state(null);
	let editName = $state('');
	let showIconPicker = $state(false);
	let saving = $state(false);

	// Device action state — editing handled by LoadEditForm component
	let editingDevice: { type: 'load' | 'receptacle'; record: V3Record; areaId: number } | null = $state(null);
	let movingDevice: { type: 'load' | 'receptacle'; record: V3Record; areaId: number } | null = $state(null);
	let moveTargetAreaId: number | null = $state(null);

	// Panel toggle: 'devices' | 'edit' | 'comments' | null
	type PanelMode = 'devices' | 'edit' | 'comments' | null;
	let activePanel: { areaId: number; mode: PanelMode } = $state({ areaId: 0, mode: null });
	let editDirty = $state(false);
	let expandedDevice: string | null = $state(null);
	let showAllDevices: Record<number, boolean> = $state({});
	// Track expanded overflow sections (popover/edit panel)
	let expandedOverflow: Record<string, boolean> = $state({});
	// Modal for large overflow lists (20+)
	let overflowModal: { title: string; items: { record: V3Record; type: 'load' | 'receptacle' }[] } | null = $state(null);

	// Create Room state
	let showCreateRoom = $state(false);
	let newRoomName = $state('');
	let newRoomFloor = $state('');
	let creatingRoom = $state(false);
	let floorDropdownOpen = $state(false);

	// Existing floor values for typeahead
	const existingFloors = $derived.by(() => {
		const floors = new Set<string>();
		for (const area of areas) {
			const f = area.fields.Floor as string | undefined;
			if (f) floors.add(f);
		}
		return [...floors].sort();
	});

	const filteredFloorSuggestions = $derived.by(() => {
		if (!newRoomFloor.trim()) return existingFloors;
		const q = newRoomFloor.toLowerCase();
		return existingFloors.filter(f => f.toLowerCase().includes(q));
	});

	async function createRoom() {
		if (!newRoomName.trim()) return;
		creatingRoom = true;
		try {
			const fields: Record<string, unknown> = { Name: newRoomName.trim() };
			if (newRoomFloor.trim()) fields.Floor = newRoomFloor.trim();

			const linkUpdates: { title: string; ids: number[] }[] = [];
			if (homeContext.selectedHomeId) {
				linkUpdates.push({ title: 'Home', ids: [homeContext.selectedHomeId] });
			}

			const resp = await fetch('/api/nocodb', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Area', fields, linkUpdates })
			});

			if (!resp.ok) throw new Error('Failed to create room');
			toast.success(`Created "${newRoomName.trim()}"`);
			showCreateRoom = false;
			newRoomName = '';
			newRoomFloor = '';
			await reloadSharedData();
		} catch (err) {
			toast.error('Failed to create room');
		} finally {
			creatingRoom = false;
		}
	}

	function getRoomIcon(area: V3Record): string {
		return (area.fields.Icon as string) || 'mdi:home';
	}

	function getRoomColor(area: V3Record): string {
		return (area.fields['Icon Color'] as string) || '#94a3b8';
	}

	function syncFromDataStore() {
		areas = homeFiltered.areas;
		allLoads = homeFiltered.loads;
		allReceptacles = homeFiltered.receptacles;
		allCircuits = homeFiltered.circuits;
		allPanels = homeFiltered.panels;
		floorplans = [...homeFiltered.floorplans].sort(
			(a, b) => ((a.fields.Order as number) || 0) - ((b.fields.Order as number) || 0)
		);
	}

	// Re-sync when home selection changes
	$effect(() => {
		// Access homeFiltered to track it reactively
		const _ = homeFiltered.areas;
		if (dataStore.loaded) syncFromDataStore();
	});

	async function reloadSharedData() {
		invalidate();
		await ensureLoaded();
		syncFromDataStore();
	}

	// Filtered & searched areas
	const filteredAreas = $derived.by(() => {
		if (!searchQuery.trim()) return areas;
		const q = searchQuery.toLowerCase();
		return areas.filter((a) => {
			const name = (a.fields.Name as string || '').toLowerCase();
			if (name.includes(q)) return true;
			// Also match if any load/receptacle in this area matches
			const areaId = a.id;
			const matchingLoads = allLoads.some((l) => {
				const la = l.fields.Area as { id: number } | undefined;
				return la?.id === areaId && (l.fields.Name as string || '').toLowerCase().includes(q);
			});
			const matchingRecs = allReceptacles.some((r) => {
				const ra = r.fields.Area as { id: number } | undefined;
				return ra?.id === areaId && (r.fields.Name as string || '').toLowerCase().includes(q);
			});
			return matchingLoads || matchingRecs;
		});
	});

	// Group areas by floor
	const floorGroups = $derived.by(() => {
		const groups: Record<string, V3Record[]> = {};
		for (const area of filteredAreas) {
			const floor = (area.fields.Floor as string) || 'Other';
			if (!groups[floor]) groups[floor] = [];
			groups[floor].push(area);
		}
		const order = ['Basement', 'Main', '1st', '2nd', '3rd', 'Attic', 'Exterior', 'Outside', 'Other'];
		const sorted: [string, V3Record[]][] = [];
		for (const o of order) {
			const match = Object.keys(groups).find((k) => k.toLowerCase().includes(o.toLowerCase()));
			if (match) { sorted.push([match, groups[match]]); delete groups[match]; }
		}
		for (const [k, v] of Object.entries(groups)) { sorted.push([k, v]); }
		return sorted;
	});

	let collapsedFloors: Record<string, boolean> = $state({});

	// Get devices for an area based on filter
	function getAreaDevices(areaId: number): { type: 'load' | 'receptacle'; record: V3Record }[] {
		const items: { type: 'load' | 'receptacle'; record: V3Record }[] = [];
		const q = searchQuery.toLowerCase();

		if (deviceFilter !== 'receptacles') {
			for (const l of allLoads) {
				const la = l.fields.Area as { id: number } | undefined;
				if (la?.id === areaId) {
					if (!q || (l.fields.Name as string || '').toLowerCase().includes(q)) {
						items.push({ type: 'load', record: l });
					}
				}
			}
		}
		if (deviceFilter !== 'loads') {
			for (const r of allReceptacles) {
				const ra = r.fields.Area as { id: number } | undefined;
				if (ra?.id === areaId) {
					if (!q || (r.fields.Name as string || '').toLowerCase().includes(q)) {
						items.push({ type: 'receptacle', record: r });
					}
				}
			}
		}
		return items;
	}

	function getDeviceBadge(item: { type: 'load' | 'receptacle'; record: V3Record }): { label: string; color: string; icon: string } | null {
		// Check for icon override
		const override = item.record.fields.Icon as string;

		if (item.type === 'receptacle') {
			const recType = item.record.fields['Receptacle Type'] as string;
			const features = item.record.fields.Features as string[] | null;
			if (features?.includes('GFCI') && receptacleTypeConfig['GFCI Outlet']) {
				const cfg = receptacleTypeConfig['GFCI Outlet'];
				return override ? { ...cfg, icon: override } : cfg;
			}
			if (recType && receptacleTypeConfig[recType]) {
				const cfg = receptacleTypeConfig[recType];
				return override ? { ...cfg, icon: override } : cfg;
			}
			const cfg = receptacleTypeConfig['Outlet'];
			return override ? { ...cfg, icon: override } : cfg;
		}
		const dt = item.record.fields['Device Type'] as string;
		if (!dt) return override ? { label: 'Custom', color: 'bg-slate-600/30 text-slate-400', icon: override } : null;
		if (loadTypeConfig[dt]) {
			const cfg = loadTypeConfig[dt];
			return override ? { ...cfg, icon: override } : cfg;
		}
		return { label: dt, color: 'bg-slate-600/30 text-slate-500', icon: override || 'mdi:help-circle-outline' };
	}

	function getCircuitInfo(item: { type: 'load' | 'receptacle'; record: V3Record }): string {
		if (item.type === 'receptacle') {
			const circuit = item.record.fields.Circuit as { id: number; fields: { Name: string } } | undefined;
			if (!circuit) return '';
			const fullCircuit = allCircuits.find((c) => c.id === circuit.id);
			const panelName = (fullCircuit?.fields.Panel as { fields: { Name: string } } | undefined)?.fields?.Name;
			return panelName ? `${panelName} · ${circuit.fields.Name}` : `Circuit · ${circuit.fields.Name}`;
		}
		const recName = item.record.fields['Receptacle Name'] as string;
		return recName || '';
	}

	function getDeviceCircuits(item: { type: 'load' | 'receptacle'; record: V3Record }): V3Record[] {
		if (item.type === 'load') return getCircuitsForLoad(item.record);
		const circuitId = getReceptacleCircuitId(item.record);
		if (circuitId === null) return [];
		const circuit = allCircuits.find((candidate) => candidate.id === circuitId);
		return circuit ? [circuit] : [];
	}

	function getLinkedRecords(value: unknown): V3Record[] {
		if (Array.isArray(value)) return value.filter((entry): entry is V3Record => !!entry && typeof entry === 'object' && 'id' in entry);
		if (value && typeof value === 'object' && 'id' in value) return [value as V3Record];
		return [];
	}

	function getReceptacleCircuitId(receptacle: V3Record): number | null {
		const circuit = receptacle.fields.Circuit as { id?: number } | undefined;
		return circuit?.id ?? (receptacle.fields.Circuit_id as number | undefined) ?? null;
	}

	function getCircuitsForReceptacles(receptacles: V3Record[]): V3Record[] {
		const circuitIds = new Set(receptacles.map(getReceptacleCircuitId).filter((id): id is number => id !== null));
		return allCircuits.filter((circuit) => circuitIds.has(circuit.id));
	}

	function getCircuitsForLoad(load: V3Record): V3Record[] {
		const directCircuitId = getReceptacleCircuitId(load);
		const loadName = load.fields.Name as string | undefined;
		const connectedReceptacles = loadName
			? allReceptacles.filter((receptacle) => {
					const linkedNames = receptacle.fields['Load Name(s)'];
					const names = typeof linkedNames === 'string'
						? linkedNames.split(',').map((name) => name.trim()).filter(Boolean)
						: Array.isArray(linkedNames) ? linkedNames.filter((name): name is string => typeof name === 'string') : [];
					return names.includes(loadName);
				})
			: [];
		const circuitIds = new Set(connectedReceptacles.map(getReceptacleCircuitId).filter((id): id is number => id !== null));
		if (directCircuitId !== null) circuitIds.add(directCircuitId);
		return allCircuits.filter((circuit) => circuitIds.has(circuit.id));
	}

	function getCircuitPanel(circuit: V3Record): V3Record | null {
		const panelLink = circuit.fields.Panel as { id?: number } | undefined;
		return panelLink?.id ? allPanels.find((panel) => panel.id === panelLink.id) || null : null;
	}

	function getCircuitNumber(circuit: V3Record): string {
		return String(circuit.fields.Number ?? circuit.fields['Circuit #'] ?? circuit.id);
	}

	function getCircuitPanelHref(circuit: V3Record): string {
		const panel = getCircuitPanel(circuit);
		const params = new URLSearchParams({ circuit: String(circuit.id) });
		if (panel) params.set('panel', String(panel.id));
		return `/panels?${params.toString()}`;
	}

	function getLoadById(id: number | null | undefined): V3Record | null {
		if (!id) return null;
		return allLoads.find((load) => load.id === id) || null;
	}

	function getNetworkUpstreamRecord(load: V3Record): V3Record | null {
		const linked = getLinkedRecords(load.fields.Network_Upstream);
		const linkedId = linked[0]?.id;
		return getLoadById(linkedId) || linked[0] || null;
	}

	function getNetworkUpstreamId(load: V3Record): number | null {
		return getNetworkUpstreamRecord(load)?.id ?? null;
	}

	function getPowerSource(load: V3Record): string {
		return (load.fields.Power_Source as string) || 'Circuit';
	}

	function isPoeLoad(load: V3Record): boolean {
		return getPowerSource(load) === 'POE';
	}

	function getDownstreamLoads(loadId: number): V3Record[] {
		return allLoads.filter((candidate) => candidate.id !== loadId && getNetworkUpstreamId(candidate) === loadId);
	}

	function getLoadFloorLabel(load: V3Record | null): string {
		if (!load) return 'Other floor';
		const floorId = load.fields.Floorplan_Id as number | null | undefined;
		const floor = floorplans.find((entry) => entry.id === floorId);
		return (floor?.fields.Floor as string) || 'Other floor';
	}

	function traceNetworkUpstream(load: V3Record) {
		const upstream = getNetworkUpstreamRecord(load);
		if (!upstream) return;
		const upstreamFloorId = upstream.fields.Floorplan_Id as number | null | undefined;
		if (upstreamFloorId && upstreamFloorId !== selectedFloorId) {
			selectedFloorId = upstreamFloorId;
		}
		viewMode = 'floorplan';
		viewLayer = 'network';
		selectedPanelMarkerId = null;
		tracingCircuitId = null;
		expandedGroup = null;
		selectedLoadId = upstream.id;
	}

	onMount(() => {
		// Detect mobile viewport
		isMobileView = window.innerWidth < 768;
		const mql = window.matchMedia('(max-width: 767px)');
		const mqlHandler = (e: MediaQueryListEvent) => { isMobileView = e.matches; };
		mql.addEventListener('change', mqlHandler);

		// Listen for fullscreen changes (handles native Escape, etc.)
		document.addEventListener('fullscreenchange', onFullscreenChange);
		document.addEventListener('webkitfullscreenchange', onFullscreenChange);

		// Async initialization
		(async () => {
			await ensureLoaded();

			syncFromDataStore();
			const savedViewLayer = window.localStorage.getItem('rooms:view-layer');
			if (savedViewLayer === 'power' || savedViewLayer === 'network') viewLayer = savedViewLayer;
			viewLayerReady = true;
			if (floorplans.length > 0) selectedFloorId = floorplans[0].id;
			// Fire comment count fetches for all areas (non-blocking)
			for (const area of areas) { fetchCommentCount(area.id); }
			loading = false;

			// Handle URL params
			handleDeepLinkParams();
		})();

		return () => {
			mql.removeEventListener('change', mqlHandler);
			document.removeEventListener('fullscreenchange', onFullscreenChange);
			document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
			document.body.style.overflow = '';
		};
	});

	// React to URL param changes for deep links (fires on client-side navigation too)
	$effect(() => {
		const url = page.url;
		if (!url || typeof window === 'undefined') return;
		handleDeepLinkParams();
	});

	function handleDeepLinkParams() {
		const urlParams = new URLSearchParams(window.location.search);

		// ?view=floorplan
		if (urlParams.get('view') === 'floorplan') {
			viewMode = 'floorplan';
		}

		// ?layer=network|power
		const layerParam = urlParams.get('layer');
		if (layerParam === 'network' || layerParam === 'power') {
			viewMode = 'floorplan';
			viewLayer = layerParam;
		}

		// ?edit=true — open placement/edit mode
		if (urlParams.get('edit') === 'true') {
			viewMode = 'floorplan';
			editingMarkers = true;
		}

		// ?area= param from search deep links (skip room panel if device param targets floorplan)
		const areaParam = urlParams.get('area');
		const deviceParam = urlParams.get('device');
		if (areaParam) {
			const areaId = parseInt(areaParam);
				const targetArea = areas.find(a => a.id === areaId);
				if (targetArea) {
					// Only open area panel if no device-specific deep link
					if (!deviceParam) {
						activePanel = { areaId, mode: 'devices' };
					}

					// Switch to correct floor in floorplan mode
					if (viewMode === 'floorplan' && targetArea.fields.Floorplan_Id) {
						selectedFloorId = targetArea.fields.Floorplan_Id as number;
					}

					// Expand the correct floor group in list mode
					const floorName = (targetArea.fields.Floor as string) || 'Other';
					if (collapsedFloors[floorName]) {
						collapsedFloors = { ...collapsedFloors, [floorName]: false };
					}

					if (!deviceParam) {
						setTimeout(() => {
							const el = document.querySelector(`[data-area-id="${areaId}"]`);
							if (el) {
								el.scrollIntoView({ behavior: 'smooth', block: 'center' });
								el.classList.add('deep-link-flash');
								setTimeout(() => el.classList.remove('deep-link-flash'), 2000);
							}
						}, 100);
					}
				}
			}

		// ?device= param — select a specific load on the floorplan
		if (deviceParam && viewMode === 'floorplan') {
			const deviceId = parseInt(deviceParam);
			const load = allLoads.find(l => l.id === deviceId);
			if (load && load.fields.Floorplan_Id) {
					selectedFloorId = load.fields.Floorplan_Id as number;
					viewLayer = 'power';
					setTimeout(() => { selectedLoadId = deviceId; }, 150);
			}
		}
	}

	$effect(() => {
		if (typeof window === 'undefined' || !viewLayerReady) return;
		window.localStorage.setItem('rooms:view-layer', viewLayer);
	});

	function toggleFloor(floor: string) {
		collapsedFloors = { ...collapsedFloors, [floor]: !collapsedFloors[floor] };
	}

	function togglePanel(areaId: number, mode: PanelMode) {
		// If same panel is active, close it (but guard dirty edit)
		if (activePanel.areaId === areaId && activePanel.mode === mode) {
			if (mode === 'edit' && editDirty) return; // don't close dirty edit
			activePanel = { areaId: 0, mode: null };
			if (mode === 'edit') cancelEdit();
			return;
		}
		// If switching away from dirty edit, block
		if (activePanel.mode === 'edit' && editDirty && activePanel.areaId !== areaId) return;
		if (activePanel.mode === 'edit') cancelEdit();
		activePanel = { areaId, mode };
		if (mode === 'comments') loadComments(areaId);
	}

	function isPanelActive(areaId: number, mode: PanelMode): boolean {
		return activePanel.areaId === areaId && activePanel.mode === mode;
	}

	function getFloorIcon(floor: string): string {
		if (floor === 'Basement') return 'mdi:stairs-down';
		if (floor === 'Main' || floor === '1st') return 'mdi:home';
		if (floor === 'Exterior' || floor === 'Outside') return 'mdi:tree';
		return 'mdi:stairs-up';
	}

	// Comments
	async function fetchCommentCount(areaId: number) {
		if (commentCounts[areaId] !== undefined) return; // already loaded or loading
		commentCounts[areaId] = null; // mark as loading
		try {
			const resp = await fetch(`/api/comments?table=Area&row_id=${areaId}`);
			if (resp.ok) {
				const data = await resp.json();
				commentCounts = { ...commentCounts, [areaId]: (data.comments || []).length };
			}
		} catch { commentCounts = { ...commentCounts, [areaId]: 0 }; }
	}

	async function loadComments(areaId: number) {
		commentsLoading = true; comments = [];
		try {
			const resp = await fetch(`/api/comments?table=Area&row_id=${areaId}`);
			if (resp.ok) {
				const data = await resp.json();
				comments = data.comments || [];
				commentCounts = { ...commentCounts, [areaId]: comments.length };
			}
		} catch {} finally { commentsLoading = false; }
	}

	async function addComment(areaId: number) {
		if (!newComment.trim()) return;
		addingComment = true;
		try {
			const resp = await fetch('/api/comments', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Area', row_id: areaId, comment: newComment.trim() })
			});
			if (resp.ok) {
				const data = await resp.json();
				comments = [...comments, data.comment];
				commentCounts = { ...commentCounts, [areaId]: comments.length };
				newComment = '';
			}
		} catch {} finally { addingComment = false; }
	}

	function toggleComments(areaId: number) {
		togglePanel(areaId, 'comments');
	}

	function formatTime(iso: string): string {
		const d = new Date(iso);
		const diffMs = Date.now() - d.getTime();
		const mins = Math.floor(diffMs / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 7) return `${days}d ago`;
		return d.toLocaleDateString();
	}

	// Quick Add
	const areaOptions = $derived(areas.map((a) => ({ id: a.id, name: a.fields.Name as string, icon: getRoomIcon(a) })));
	function openQuickAdd(areaId?: number) { if (isLocked) { toast.error('Home is locked'); return; } quickAddAreaId = areaId; showQuickAdd = true; }
	function openQuickAddReceptacle(areaId?: number) { if (isLocked) { toast.error('Home is locked'); return; } quickAddAreaId = areaId; showQuickAddReceptacle = true; }
	async function onLoadSaved(load: SavedLoad) {
		showQuickAdd = false;
		toast.success(`Added "${load.name}"`);
		await reloadSharedData();
	}
	async function onReceptacleSaved(rec: SavedReceptacle) {
		showQuickAddReceptacle = false;
		toast.success(`Added "${rec.name}"`);
		await reloadSharedData();
	}

	// Editing
	function startEdit(area: V3Record) {
		editingArea = area;
		editName = area.fields.Name as string;
		editDirty = false;
		togglePanel(area.id, 'edit');
	}
	function cancelEdit() { editingArea = null; editName = ''; showIconPicker = false; editDirty = false; }

	async function saveEdit() {
		if (!editingArea) return;
		saving = true;
		const fields: Record<string, unknown> = {};
		if (editName !== editingArea.fields.Name) fields.Name = editName;
		const currentColor = editingArea.fields['Icon Color'] as string;
		// Color is already updated in editingArea.fields directly via onclick
		if (currentColor) fields['Icon Color'] = currentColor;
		if (Object.keys(fields).length === 0) { cancelEdit(); activePanel = { areaId: 0, mode: null }; saving = false; return; }
		try {
			const resp = await fetch('/api/nocodb', {
				method: 'PATCH', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Area', id: editingArea.id, fields })
			});
			if (resp.ok) {
				for (const [k, v] of Object.entries(fields)) editingArea.fields[k] = v;
				toast.success(`Updated ${editName}`);
			}
		} catch {} finally { saving = false; editingArea = null; editName = ''; editDirty = false; activePanel = { areaId: 0, mode: null }; }
	}

	async function updateIcon(icon: string) {
		if (!editingArea) return;
		showIconPicker = false; saving = true;
		try {
			const resp = await fetch('/api/nocodb', {
				method: 'PATCH', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Area', id: editingArea.id, fields: { Icon: icon } })
			});
			if (resp.ok) {
				editingArea.fields.Icon = icon;
				toast.success(`Icon updated`);
			}
		} catch {} finally { saving = false; }
	}

	// Device actions
	function startEditDevice(item: { type: 'load' | 'receptacle'; record: V3Record }, areaId: number) {
		editingDevice = { ...item, areaId };
		movingDevice = null;
	}

	function handleDeviceSaved(updatedFields: Record<string, unknown>) {
		if (!editingDevice) return;
		// Optimistic UI update: apply changed fields to the in-memory record
		for (const [key, value] of Object.entries(updatedFields)) {
			editingDevice.record.fields[key] = value;
		}
		toast.success('Device updated');
		editingDevice = null;
	}

	function startMoveDevice(item: { type: 'load' | 'receptacle'; record: V3Record }, areaId: number) {
		movingDevice = { ...item, areaId };
		moveTargetAreaId = null;
		editingDevice = null;
	}

	async function confirmMoveDevice() {
		if (!movingDevice || !moveTargetAreaId || moveTargetAreaId === movingDevice.areaId) return;
		saving = true;
		const table = movingDevice.type === 'load' ? 'Load' : 'Receptacle';
		try {
			const resp = await fetch('/api/nocodb', {
				method: 'PATCH', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table, id: movingDevice.record.id, fields: { Area: moveTargetAreaId } })
			});
			if (resp.ok) {
				// Update local data — change the area link
				(movingDevice.record.fields as Record<string, unknown>).Area = { id: moveTargetAreaId };
				const targetName = areas.find((a) => a.id === moveTargetAreaId)?.fields.Name || 'room';
				toast.success(`Moved to ${targetName}`);
			}
		} catch {} finally { saving = false; movingDevice = null; moveTargetAreaId = null; }
	}

	function deleteDevice(item: { type: 'load' | 'receptacle'; record: V3Record }) {
		const name = item.record.fields.Name as string;
		confirmDialog = {
			open: true,
			title: `Delete "${name}"?`,
			description: 'This cannot be undone.',
			variant: 'danger',
			onConfirm: async () => {
				saving = true;
				const table = item.type === 'load' ? 'Load' : 'Receptacle';
				try {
					const resp = await fetch(`/api/nocodb?table=${table}&id=${item.record.id}`, { method: 'DELETE' });
					if (resp.ok) {
						if (item.type === 'load') {
							allLoads = allLoads.filter((l) => l.id !== item.record.id);
						} else {
							allReceptacles = allReceptacles.filter((r) => r.id !== item.record.id);
						}
						toast.success(`Deleted "${name}"`);
					}
				} catch {} finally { saving = false; }
			}
		};
	}

	// Floorplan helpers
	const selectedFloorplan = $derived(floorplans.find(f => f.id === selectedFloorId));

	function getFloorplanImage(fp: V3Record): string | null {
		const att = fp.fields.Image as Attachment[] | undefined;
		if (att && att.length > 0) return `/api/image?path=${encodeURIComponent(att[0].signedPath)}`;
		return null;
	}

	async function handleFloorplanUpload(file: File, floorName?: string) {
		uploading = true;
		try {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('table', 'Floorplan');
			formData.append('field', 'Image');
			formData.append('fields', JSON.stringify({ Floor: floorName || `Floor ${floorplans.length + 1}`, Order: floorplans.length + 1 }));
			const resp = await fetch('/api/upload', { method: 'POST', body: formData });
			if (resp.ok) {
				const data = await resp.json();
				// Link the new floorplan to the current home
				if (data.record && homeContext.selectedHomeId) {
					const newId = data.record.Id ?? data.record.id;
					if (newId) {
						await fetch('/api/nocodb', {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ table: 'Floorplan', id: newId, linkUpdates: [{ title: 'Home', ids: [homeContext.selectedHomeId] }] })
						});
					}
				}
				await reloadSharedData();
				// Select the newly created floorplan
				if (data.record) {
					const newId = data.record.Id ?? data.record.id;
					selectedFloorId = newId;
						// Immediately enter rename mode so user can name it
						renamingFloorId = newId;
						renameFloorValue = floorName || `Floor ${floorplans.length}`;
					}
				// Fallback: select first if no match
				if (!floorplans.find(f => f.id === selectedFloorId) && floorplans.length > 0) {
					selectedFloorId = floorplans[0].id;
				}
				toast.success('Floorplan uploaded!');
			} else {
				const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
				console.error('Upload response error:', err);
				toast.success(`Upload failed: ${err.error || resp.statusText}`);
			}
		} catch (e) {
			console.error('Upload failed:', e);
			toast.error('Upload failed — check console');
		} finally {
			uploading = false;
		}
	}

	async function handlePaste(e: ClipboardEvent) {
		if (viewMode !== 'floorplan') return;
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const file = item.getAsFile();
				if (file) await handleFloorplanUpload(file);
				return;
			}
		}
	}

	async function renameFloor(fpId: number, newName: string) {
		if (!newName.trim()) return;
		try {
			await fetch('/api/nocodb', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Floorplan', id: fpId, fields: { Floor: newName.trim() } })
			});
			const fp = floorplans.find(f => f.id === fpId);
			if (fp) fp.fields.Floor = newName.trim();
			renamingFloorId = null;
			toast.success('Floor renamed');
		} catch (e) {
			console.error('Rename failed:', e);
		}
	}

	function deleteFloor(fpId: number) {
		const fp = floorplans.find(f => f.id === fpId);
		const name = (fp?.fields.Floor as string) || 'this floor';
		confirmDialog = {
			open: true,
			title: `Delete "${name}"?`,
			description: 'This will remove the floorplan image and cannot be undone.',
			variant: 'danger',
			onConfirm: async () => {
				try {
					await fetch(`/api/nocodb?table=Floorplan&id=${fpId}`, { method: 'DELETE' });
					floorplans = floorplans.filter(f => f.id !== fpId);
					if (selectedFloorId === fpId) {
						selectedFloorId = floorplans.length > 0 ? floorplans[0].id : null;
					}
					showFloorMenu = null;
					toast.success('Floor deleted');
				} catch (e) {
					console.error('Delete failed:', e);
				}
			}
		};
	}

	async function moveFloor(fpId: number, direction: 'left' | 'right') {
		const idx = floorplans.findIndex(f => f.id === fpId);
		const swapIdx = direction === 'left' ? idx - 1 : idx + 1;
		if (swapIdx < 0 || swapIdx >= floorplans.length) return;

		// Swap in local array
		const temp = floorplans[idx];
		floorplans[idx] = floorplans[swapIdx];
		floorplans[swapIdx] = temp;
		floorplans = [...floorplans]; // trigger reactivity

		// Persist order
		for (let i = 0; i < floorplans.length; i++) {
			fetch('/api/nocodb', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Floorplan', id: floorplans[i].id, fields: { Order: i + 1 } })
			});
		}
		showFloorMenu = null;
	}

	// Floorplan interaction: place marker on tap
	async function placeItemAtCoords(coords: { Floorplan_X: number; Floorplan_Y: number; Floorplan_Id: number | null }) {
		if (!placingItem) return;
		if (placingItem.type === 'room' && placingItem.areaId) {
			await fetch('/api/nocodb', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Area', id: placingItem.areaId, fields: coords })
			});
			const area = areas.find(a => a.id === placingItem?.areaId);
			if (area) Object.assign(area.fields, coords);
			placingItem = null;
			markerTick++;
			toast.success('Room placed!');
		} else if (placingItem.type === 'load' && placingItem.id) {
			await fetch('/api/nocodb', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Load', id: placingItem.id, fields: coords })
			});
			const load = allLoads.find(l => l.id === placingItem?.id);
			if (load) Object.assign(load.fields, coords);
			placingItem = null;
			markerTick++;
			toast.success('Load placed!');
		} else if (placingItem.type === 'receptacle' && placingItem.id) {
				const rec = allReceptacles.find(r => r.id === placingItem?.id);
				if (rec) {
					const gangMates = getGangMates(rec);
					const toPlace = [rec, ...gangMates.filter(m => !m.fields.Floorplan_Id)];
					for (const r of toPlace) {
						await fetch('/api/nocodb', {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ table: 'Receptacle', id: r.id, fields: coords })
						});
						Object.assign(r.fields, coords);
					}
					toast.success(toPlace.length > 1 ? `Placed ${toPlace.length}-gang box!` : 'Receptacle placed!');
				}
				placingItem = null;
				markerTick++;
		} else if (placingItem.type === 'panel' && placingItem.id) {
			await fetch('/api/nocodb', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Panel', id: placingItem.id, fields: coords })
			});
			const panel = allPanels.find(p => p.id === placingItem?.id);
			if (panel) Object.assign(panel.fields, coords);
			placingItem = null;
			markerTick++;
			toast.success('Panel placed!');
		}
	}

	/** Start fixture placement mode for a load */
	async function startPlacingFixtures(loadId: number) {
		const load = allLoads.find(l => l.id === loadId);
		if (!load) return;
		const count = (load.fields.Fixture_Count as number) || 1;
		if (count <= 1) return;

		const existing = getFixturePositions(load);

		// Auto-place first fixture at the load's current position if none placed yet
		if (existing.length === 0 && load.fields.Floorplan_X != null) {
			const firstPos = { x: load.fields.Floorplan_X as number, y: load.fields.Floorplan_Y as number };
			const positions = [firstPos];
			const posJson = JSON.stringify(positions);
			await fetch('/api/nocodb', {
				method: 'PATCH', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Load', id: load.id, fields: { Fixture_Positions: posJson } })
			});
			load.fields.Fixture_Positions = posJson;
			markerTick++;

			if (count === 2) {
				// Only one more to place
				placingFixture = { loadId, fixtureIndex: 1, total: count };
			} else {
				placingFixture = { loadId, fixtureIndex: 1, total: count };
			}
		} else if (existing.length >= count) {
			// All placed already — just expand for dragging
			expandedFixtureLoadId = loadId;
			selectedLoadId = null; // hide popover so user can see and drag
			toast.info('Drag fixtures to reposition');
			return;
		} else {
			placingFixture = { loadId, fixtureIndex: existing.length, total: count };
		}

		selectedLoadId = null; // close popover
		expandedFixtureLoadId = loadId; // show existing fixtures
		if (!editingMarkers) editingMarkers = true;
		toast.info(`Tap to place fixture ${placingFixture!.fixtureIndex + 1} of ${count}`);
	}

	/** Place next fixture at coordinates */
	async function placeFixtureAtCoords(x: number, y: number) {
		if (!placingFixture) return;
		const load = allLoads.find(l => l.id === placingFixture!.loadId);
		if (!load) { placingFixture = null; return; }

		// Get existing positions and append
		const existing = getFixturePositions(load);
		const positions = [...existing, { x, y }];

		// Save to NocoDB
		const posJson = JSON.stringify(positions);
		await fetch('/api/nocodb', {
			method: 'PATCH', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ table: 'Load', id: load.id, fields: { Fixture_Positions: posJson } })
		});
		load.fields.Fixture_Positions = posJson;
		markerTick++;

		// Advance to next fixture or finish
		const nextIndex = placingFixture.fixtureIndex + 1;
		if (nextIndex < placingFixture.total) {
			placingFixture = { ...placingFixture, fixtureIndex: nextIndex };
			toast.info(`Tap to place fixture ${nextIndex + 1} of ${placingFixture.total}`);
		} else {
			placingFixture = null;
			toast.success('All fixtures placed!');
			// Auto-expand so user can see them
			expandedFixtureLoadId = load.id;
			selectedLoadId = load.id;
		}
	}

	/** Start dragging a fixture sub-marker */
	function startDragFixture(e: PointerEvent, loadId: number, fixtureIndex: number, x: number, y: number) {
		e.preventDefault();
		selectedLoadId = null; // hide popover during drag
		draggingFixture = { loadId, fixtureIndex, startX: x, startY: y };
		dragFixturePos = { x, y };
		dragMoved = false;
		// Let event bubble to [role="img"] for pointer capture
	}

	/** Handle fixture drag end — save new position */
	async function handleFixtureDragEnd() {
		if (!draggingFixture || !dragFixturePos) { draggingFixture = null; dragFixturePos = null; return; }
		if (!dragMoved) { draggingFixture = null; dragFixturePos = null; return; }

		const load = allLoads.find(l => l.id === draggingFixture!.loadId);
		if (!load) { draggingFixture = null; dragFixturePos = null; return; }

		const positions = getFixturePositions(load);
		if (draggingFixture.fixtureIndex < positions.length) {
			positions[draggingFixture.fixtureIndex] = { x: dragFixturePos.x, y: dragFixturePos.y };
			const posJson = JSON.stringify(positions);
			await fetch('/api/nocodb', {
				method: 'PATCH', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Load', id: load.id, fields: { Fixture_Positions: posJson } })
			});
			load.fields.Fixture_Positions = posJson;
			markerTick++;
		}
		draggingFixture = null;
		dragFixturePos = null;
		snapGuides = [];
	}
	const SNAP_THRESHOLD = 0.018; // ~1.8% of container width/height
	let snapGuides: { type: 'x' | 'y'; value: number }[] = $state([]);
	let previewPos: { x: number; y: number } | null = $state(null);

	// Snap modifiers: Shift = disable vertical snap (free Y), Alt = disable horizontal snap (free X)
	function getSnapPosition(rawX: number, rawY: number, opts?: { skipX?: boolean; skipY?: boolean }): { x: number; y: number } {
		const guides: { type: 'x' | 'y'; value: number }[] = [];
		let snappedX = rawX;
		let snappedY = rawY;

		// Collect all placed marker positions
		const positions: { x: number; y: number }[] = [];
		if (selectedFloorplan) {
			for (const area of getAreasForFloor(selectedFloorplan)) {
				const pos = getAreaPosition(area);
				if (pos) positions.push(pos);
			}
		}
		for (const load of getLoadsForFloor()) {
			positions.push({ x: load.fields.Floorplan_X as number, y: load.fields.Floorplan_Y as number });
			// Include expanded fixture positions as snap targets (exclude the one being dragged)
			if (isLoadFixtureExpanded(load)) {
				const fps = getFixturePositions(load);
				for (let fi = 0; fi < fps.length; fi++) {
					if (draggingFixture && draggingFixture.loadId === load.id && draggingFixture.fixtureIndex === fi) continue;
					positions.push(fps[fi]);
				}
			}
		}
		for (const group of getReceptacleGroupsForFloor()) {
			positions.push({ x: group.x, y: group.y });
		}
		// Include panel positions as snap targets
		for (const panel of allPanels) {
			if (panel.fields.Floorplan_X != null && panel.fields.Floorplan_Y != null && panel.fields.Floorplan_Id === selectedFloorId) {
				positions.push({ x: panel.fields.Floorplan_X as number, y: panel.fields.Floorplan_Y as number });
			}
		}

		// Check X alignment (vertical guide line) — skip if Alt held
		if (!opts?.skipX) {
			for (const pos of positions) {
				if (Math.abs(rawX - pos.x) < SNAP_THRESHOLD) {
					snappedX = pos.x;
					guides.push({ type: 'x', value: pos.x });
					break;
				}
			}
		}
		// Check Y alignment (horizontal guide line) — skip if Shift held
		if (!opts?.skipY) {
			for (const pos of positions) {
				if (Math.abs(rawY - pos.y) < SNAP_THRESHOLD) {
					snappedY = pos.y;
					guides.push({ type: 'y', value: pos.y });
					break;
				}
			}
		}

		snapGuides = guides;
		return { x: Math.round(snappedX * 1000) / 1000, y: Math.round(snappedY * 1000) / 1000 };
	}

	// Convert mouse event to floorplan-relative 0-1 coords, accounting for zoom/pan transform
	function getFloorplanCoords(e: MouseEvent): { rawX: number; rawY: number } {
		const container = (e.currentTarget as HTMLElement);
		const rect = container.getBoundingClientRect();
		// Mouse position relative to container center (in px)
		const cx = rect.width / 2;
		const cy = rect.height / 2;
		const mouseX = e.clientX - rect.left - cx;
		const mouseY = e.clientY - rect.top - cy;
		// Reverse the transform: scale(S) translate(tx/S, ty/S) with origin=center
		// Transformed point = (point + translate) * scale  (relative to center)
		// So: point = mouse/scale - translate/scale
		const tx = floorplanTranslate.x / floorplanScale;
		const ty = floorplanTranslate.y / floorplanScale;
		const untransformedX = mouseX / floorplanScale - tx;
		const untransformedY = mouseY / floorplanScale - ty;
		// Convert back to 0-1 range (relative to container top-left)
		const rawX = (untransformedX + cx) / rect.width;
		const rawY = (untransformedY + cy) / rect.height;
		return { rawX, rawY };
	}

	function handlePlacingMouseMove(e: MouseEvent) {
		if (placingFixture) {
			const { rawX, rawY } = getFloorplanCoords(e);
			const snapped = getSnapPosition(rawX, rawY, { skipX: e.altKey, skipY: e.shiftKey });
			previewPos = snapped;
			return;
		}
		if (!editingMarkers || !placingItem) { previewPos = null; snapGuides = []; mergeTargetKey = null; return; }
		const { rawX, rawY } = getFloorplanCoords(e);
		const snapped = getSnapPosition(rawX, rawY, { skipX: e.altKey, skipY: e.shiftKey });
		previewPos = snapped;
		updateMergeTarget(snapped.x, snapped.y);
	}

	async function handleFloorplanClick(e: MouseEvent) {
		// Ignore clicks that were part of a pan or drag gesture
		if (panMoved) { panMoved = false; return; }
		if (dragMoved) { dragMoved = false; return; }
		if (dragClickPending) { dragClickPending = false; return; }

		// Fixture placement mode
		if (placingFixture) {
			const { rawX, rawY } = getFloorplanCoords(e);
			const snapped = getSnapPosition(rawX, rawY, { skipX: e.altKey, skipY: e.shiftKey });
			previewPos = null;
			snapGuides = [];
			await placeFixtureAtCoords(snapped.x, snapped.y);
			return;
		}

		if (!editingMarkers || !placingItem) {
			// Dismiss any open popovers
			selectedLoadId = null;
			expandedGroup = null;
			expandedCluster = null;
			selectedPanelMarkerId = null;
			tracingCircuitId = null;
			activePanel = { areaId: 0, mode: null };
			return;
		}
		const { rawX, rawY } = getFloorplanCoords(e);

		const snapped = getSnapPosition(rawX, rawY, { skipX: e.altKey, skipY: e.shiftKey });
		let coords = { Floorplan_X: snapped.x, Floorplan_Y: snapped.y, Floorplan_Id: selectedFloorId };

		// If merging into a cluster (panel or other), snap to the cluster anchor position
		if (mergeTargetKey) {
			const clusters = getMarkerClusters();
			const targetCluster = clusters.find(c => c.key === mergeTargetKey);
			if (targetCluster) {
				const anchor = targetCluster.items.find(i => i.type === 'panel') || targetCluster.items.find(i => i.type === 'room') || targetCluster.items[0];
				coords = { Floorplan_X: anchor.x, Floorplan_Y: anchor.y, Floorplan_Id: selectedFloorId };
			}
		}

		previewPos = null;
		snapGuides = [];
		mergeTargetKey = null;
		await placeItemAtCoords(coords);
	}

	async function removePin(area: V3Record) {
		confirmDialog = {
			open: true,
			title: `Remove "${area.fields.Name}" pin?`,
			description: 'This room marker will be removed from the floorplan.',
			variant: 'danger',
			onConfirm: async () => {
				await fetch('/api/nocodb', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ table: 'Area', id: area.id, fields: { Floorplan_X: null, Floorplan_Y: null, Floorplan_Id: null } })
				});
				area.fields.Floorplan_X = null;
				area.fields.Floorplan_Y = null;
				area.fields.Floorplan_Id = null;
				areas = [...areas];
				activePanel = { areaId: 0, mode: null };
				toast.success('Pin removed');
			}
		};
	}

	async function removeLoadPin(load: V3Record) {
		confirmDialog = {
			open: true,
			title: `Remove "${getFullName(load)}" pin?`,
			description: 'This load marker will be removed from the floorplan.',
			variant: 'danger',
			onConfirm: async () => {
				await fetch('/api/nocodb', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ table: 'Load', id: load.id, fields: { Floorplan_X: null, Floorplan_Y: null, Floorplan_Id: null } })
				});
				load.fields.Floorplan_X = null;
				load.fields.Floorplan_Y = null;
				load.fields.Floorplan_Id = null;
				allLoads = [...allLoads];
				selectedLoadId = null;
				toast.success('Pin removed');
			}
		};
	}

	async function removeReceptaclePin(rec: V3Record) {
		const mates = getGangMates(rec).filter(m => m.fields.Floorplan_Id);
		const count = mates.length + 1;
		confirmDialog = {
			open: true,
			title: `Remove ${count > 1 ? count + '-gang box' : 'receptacle'} pin?`,
			description: count > 1 ? `This will remove ${count} receptacles from the floorplan.` : 'This receptacle marker will be removed.',
			variant: 'danger',
			onConfirm: async () => {
				await fetch('/api/nocodb', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ table: 'Receptacle', id: rec.id, fields: { Floorplan_X: null, Floorplan_Y: null, Floorplan_Id: null } })
				});
				rec.fields.Floorplan_X = null;
				rec.fields.Floorplan_Y = null;
				rec.fields.Floorplan_Id = null;
				for (const mate of mates) {
					await fetch('/api/nocodb', {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ table: 'Receptacle', id: mate.id, fields: { Floorplan_X: null, Floorplan_Y: null, Floorplan_Id: null } })
					});
					mate.fields.Floorplan_X = null;
					mate.fields.Floorplan_Y = null;
					mate.fields.Floorplan_Id = null;
				}
				allReceptacles = [...allReceptacles];
				expandedGroup = null;
				toast.success('Pin removed');
			}
		};
	}

	// Remove a single receptacle from a gang box (unpin just one member)
	async function removeFromGang(rec: V3Record) {
		await fetch('/api/nocodb', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ table: 'Receptacle', id: rec.id, fields: { Floorplan_X: null, Floorplan_Y: null, Floorplan_Id: null } })
		});
		rec.fields.Floorplan_X = null;
		rec.fields.Floorplan_Y = null;
		rec.fields.Floorplan_Id = null;
		allReceptacles = [...allReceptacles];
		markerTick++;
		toast.success(`Removed ${getDisplayName(rec, 'Receptacle')} from gang`);
	}

	// Add a receptacle to an existing gang box (give it the same position)
	async function addToGang(rec: V3Record, group: ReceptacleGroup) {
		const fields = { Floorplan_X: group.x, Floorplan_Y: group.y, Floorplan_Id: selectedFloorId };
		await fetch('/api/nocodb', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ table: 'Receptacle', id: rec.id, fields })
		});
		Object.assign(rec.fields, fields);
		allReceptacles = [...allReceptacles];
		markerTick++;
		toast.success(`Added ${getDisplayName(rec, 'Receptacle')} to gang`);
	}

	// Floor selection with direction tracking for carousel transition
	function selectFloor(newId: number) {
		if (newId === selectedFloorId) return;
		const oldIdx = floorplans.findIndex(f => f.id === selectedFloorId);
		const newIdx = floorplans.findIndex(f => f.id === newId);
		floorSlideDirection = newIdx >= oldIdx ? 1 : -1;
		selectedFloorId = newId;
	}

	// Pinch-to-zoom and pan

	// Touch pinch-zoom state
	let touchStartDist = 0;
	let touchStartScale = 1;
	let touchStartMid = { x: 0, y: 0 };
	let touchStartTranslate = { x: 0, y: 0 };
	let isTouchZooming = false;

	function getTouchDist(t1: Touch, t2: Touch): number {
		return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
	}

	function handleTouchStart(e: TouchEvent) {
		if (e.touches.length === 2) {
			e.preventDefault();
			isTouchZooming = true;
			const t1 = e.touches[0], t2 = e.touches[1];
			touchStartDist = getTouchDist(t1, t2);
			touchStartScale = floorplanScale;
			touchStartTranslate = { ...floorplanTranslate };
			touchStartMid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
		}
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isTouchZooming || e.touches.length < 2) return;
		e.preventDefault();
		const t1 = e.touches[0], t2 = e.touches[1];
		const dist = getTouchDist(t1, t2);
		const scale = Math.max(1, Math.min(5, touchStartScale * (dist / touchStartDist)));
		floorplanScale = scale;
		if (scale <= 1) {
			floorplanTranslate = { x: 0, y: 0 };
		} else {
			// Pan so zoom feels centered on the midpoint between fingers
			const mid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
			floorplanTranslate = {
				x: touchStartTranslate.x + (mid.x - touchStartMid.x),
				y: touchStartTranslate.y + (mid.y - touchStartMid.y)
			};
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (e.touches.length < 2) {
			isTouchZooming = false;
		}
	}

	function resetZoom() {
		floorplanScale = 1;
		floorplanTranslate = { x: 0, y: 0 };
	}

	function setFloorplanZoom(requestedScale: number, focalPoint = { x: 0, y: 0 }): boolean {
		const newScale = Math.max(1, Math.min(5, requestedScale));
		if (newScale === floorplanScale) return false;

		if (newScale === 1) {
			resetZoom();
			return true;
		}

		const scaleFactor = newScale / floorplanScale;
		floorplanTranslate = {
			x: focalPoint.x * (1 - scaleFactor) + floorplanTranslate.x * scaleFactor,
			y: focalPoint.y * (1 - scaleFactor) + floorplanTranslate.y * scaleFactor
		};
		floorplanScale = newScale;
		return true;
	}

	function handleFloorplanWheel(e: WheelEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const focalPoint = {
			x: e.clientX - rect.left - rect.width / 2,
			y: e.clientY - rect.top - rect.height / 2
		};
		const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;

		if (setFloorplanZoom(floorplanScale * zoomFactor, focalPoint)) {
			e.preventDefault();
		}
	}

	let panStart = { x: 0, y: 0 };
	let panMoved = false;
	function handlePanStart(e: PointerEvent) {
		// Capture pointer for fixture drag (event bubbles from span)
		if (draggingFixture) {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
			return;
		}
		if (floorplanScale <= 1) return;
		if (editingMarkers && placingItem) return; // don't pan when placing
		if (placingFixture) return; // don't pan when placing fixtures
		if (draggingMarker) return; // don't pan when dragging
		if (isTouchZooming) return; // don't pan during pinch-zoom
		// Don't capture if clicking a marker button or fixture marker span
		if ((e.target as HTMLElement).closest('button, [data-fixture]')) return;
		isPanning = true;
		panMoved = false;
		panStart = { x: e.clientX - floorplanTranslate.x, y: e.clientY - floorplanTranslate.y };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function handlePanMove(e: PointerEvent) {
		if (!isPanning || draggingMarker || draggingFixture) return;
		panMoved = true;
		floorplanTranslate = { x: e.clientX - panStart.x, y: e.clientY - panStart.y };
	}
	function handlePanEnd() {
		isPanning = false;
	}

	// Drag-to-reposition markers
	let draggingMarker: { type: 'room' | 'load' | 'receptacle-group' | 'panel'; id: number | string; startX: number; startY: number } | null = $state(null);
	let dragPos: { x: number; y: number } | null = $state(null);
	let dragMoved = false;

	function startDragMarker(e: PointerEvent, type: 'room' | 'load' | 'receptacle-group' | 'panel', id: number | string, currentX: number, currentY: number) {
		if (!editingMarkers || placingItem) return;
		e.stopPropagation();
		draggingMarker = { type, id, startX: currentX, startY: currentY };
		dragPos = { x: currentX, y: currentY };
		dragMoved = false;
		dragClickPending = true;
		// Capture on the floorplan container so moves fire there
		const container = (e.currentTarget as HTMLElement).closest('[role="img"]') as HTMLElement;
		if (container) container.setPointerCapture(e.pointerId);
	}

	// When drag ends without movement, we fire the marker's click action ourselves
	let dragClickPending = false;

	function handleDragMove(e: PointerEvent) {
		if (!draggingMarker && !draggingFixture) return;
		dragMoved = true;
		dragClickPending = false;
		const container = (e.currentTarget as HTMLElement);
		const rect = container.getBoundingClientRect();
		const cx = rect.width / 2;
		const cy = rect.height / 2;
		const mouseX = e.clientX - rect.left - cx;
		const mouseY = e.clientY - rect.top - cy;
		const tx = floorplanTranslate.x / floorplanScale;
		const ty = floorplanTranslate.y / floorplanScale;
		const rawX = (mouseX / floorplanScale - tx + cx) / rect.width;
		const rawY = (mouseY / floorplanScale - ty + cy) / rect.height;
		const snapped = getSnapPosition(rawX, rawY, { skipX: e.altKey, skipY: e.shiftKey });

		if (draggingFixture) {
			dragFixturePos = snapped;
		} else {
			dragPos = snapped;
			updateMergeTarget(snapped.x, snapped.y);
		}
	}

	async function handleDragEnd() {
		// Fixture drag end
		if (draggingFixture) {
			await handleFixtureDragEnd();
			return;
		}
		if (!draggingMarker || !dragPos) { draggingMarker = null; dragPos = null; return; }
		if (!dragMoved) {
			// Was just a click, not a drag — fire the marker's click action
			const { type, id } = draggingMarker;
			draggingMarker = null; dragPos = null;
			if (type === 'room') {
				selectedLoadId = null; expandedGroup = null; expandedCluster = null; selectedPanelMarkerId = null;
				activePanel = activePanel.areaId === id ? { areaId: 0, mode: null } : { areaId: id as number, mode: 'devices' };
			} else if (type === 'load') {
				expandedGroup = null; expandedCluster = null; selectedPanelMarkerId = null;
				selectedLoadId = selectedLoadId === id ? null : id as number;
			} else if (type === 'receptacle-group') {
				selectedLoadId = null; expandedCluster = null; selectedPanelMarkerId = null;
				expandedGroup = expandedGroup === id ? null : id as string;
			} else if (type === 'panel') {
				selectedLoadId = null; expandedGroup = null; expandedCluster = null;
				selectedPanelMarkerId = selectedPanelMarkerId === id ? null : id as number;
			}
			return;
		}
		const coords = { Floorplan_X: dragPos.x, Floorplan_Y: dragPos.y, Floorplan_Id: selectedFloorId };

		// If merging into an existing cluster, snap to the target cluster's anchor position
		// (room marker position if present, otherwise first item) so cluster doesn't shift
		if (mergeTargetKey) {
			const clusters = getMarkerClusters();
			const targetCluster = clusters.find(c => c.key === mergeTargetKey);
			if (targetCluster) {
				const anchor = targetCluster.items.find(i => i.type === 'panel') || targetCluster.items.find(i => i.type === 'room') || targetCluster.items[0];
				coords.Floorplan_X = anchor.x;
				coords.Floorplan_Y = anchor.y;
			}
		}

		const { type, id } = draggingMarker;

		if (type === 'room') {
			await fetch('/api/nocodb', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table: 'Area', id, fields: coords }) });
			const area = areas.find(a => a.id === id);
			if (area) Object.assign(area.fields, coords);
		} else if (type === 'load') {
			await fetch('/api/nocodb', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table: 'Load', id, fields: coords }) });
			const load = allLoads.find(l => l.id === id);
			if (load) Object.assign(load.fields, coords);
		} else if (type === 'receptacle-group') {
			// Move all members of the group
			const group = getReceptacleGroupsForFloor().find(g => g.key === id);
			if (group) {
				for (const r of group.members) {
					await fetch('/api/nocodb', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table: 'Receptacle', id: r.id, fields: coords }) });
					Object.assign(r.fields, coords);
				}
			}
		} else if (type === 'panel') {
			await fetch('/api/nocodb', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table: 'Panel', id, fields: coords }) });
			const panel = allPanels.find(p => p.id === id);
			if (panel) Object.assign(panel.fields, coords);
		}
		markerTick++; // force re-clustering
		mergeTargetKey = null;
		draggingMarker = null;
		dragPos = null;
		snapGuides = [];
	}

	function getDraggedPos(type: string, id: number | string, originalX: number, originalY: number): { x: number; y: number } {
		if (draggingMarker && dragPos && draggingMarker.type === type && draggingMarker.id === id) return dragPos;
		return { x: originalX, y: originalY };
	}
	function getAreaPosition(area: V3Record): { x: number; y: number } | null {
		const x = area.fields.Floorplan_X as number | undefined;
		const y = area.fields.Floorplan_Y as number | undefined;
		if (x != null && y != null) return { x, y };
		return null;
	}

	function getAreasForFloor(fp: V3Record): V3Record[] {
		// Show areas that are linked to this specific floorplan
		return areas.filter(a => a.fields.Floorplan_X != null && a.fields.Floorplan_Y != null && a.fields.Floorplan_Id === fp.id);
	}

	function getUnplacedAreas(): V3Record[] {
		// Areas not placed on ANY floorplan (house-wide)
		return areas.filter(a => !(a.fields.Floorplan_X != null && a.fields.Floorplan_Y != null && a.fields.Floorplan_Id));
	}

	function getLoadsForFloor(): V3Record[] {
		return allLoads.filter(l => l.fields.Floorplan_X != null && l.fields.Floorplan_Y != null && l.fields.Floorplan_Id === selectedFloorId);
	}

	function getReceptaclesForFloor(): V3Record[] {
		return allReceptacles.filter(r => r.fields.Floorplan_X != null && r.fields.Floorplan_Y != null && r.fields.Floorplan_Id === selectedFloorId);
	}

	// Gang grouping: cluster receptacles by physical box location
	type ReceptacleGroup = {
		key: string;
		x: number;
		y: number;
		members: V3Record[];
		primaryMarker: { icon: string; bg: string };
	};

	function getReceptacleGroupsForFloor(): ReceptacleGroup[] {
		const placed = getReceptaclesForFloor();
		const groups = new Map<string, V3Record[]>();

		for (const rec of placed) {
			const areaId = (rec.fields.Area_id || rec.fields.AreaId || '') as string;
			const dir = (rec.fields['Loc.Direction'] as string || '').charAt(0); // First letter: N/S/E/W
			const place = (rec.fields['Loc.Placement'] as string || '').charAt(0); // First letter: W/C/F
			const recIdx = rec.fields['Loc.Rec.Index'] as number || 0;

			// Group key: same area + direction + placement + rec index = same physical box
			// Index 0 means "unassigned" — treat each as its own group
			const key = recIdx ? `${areaId}-${dir}${place}-${recIdx}` : `_solo_${rec.id}`;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(rec);
		}

		const result: ReceptacleGroup[] = [];
		for (const [key, members] of groups) {
			// Use the first member's position as the group position
			const anchor = members[0];
			const x = anchor.fields.Floorplan_X as number;
			const y = anchor.fields.Floorplan_Y as number;
			// Primary marker: if multi-gang show the "most prominent" type
			const primary = members.length === 1
				? getDeviceMarker(members[0], 'receptacle')
				: getBestGroupMarker(members);
			result.push({ key, x, y, members, primaryMarker: primary });
		}
		return result;
	}

	function getBestGroupMarker(members: V3Record[]): { icon: string; bg: string } {
		// Priority: Smart Switch > Dimmer > On/Off Switch > GFCI > Outlet > Other
		const priority = ['Smart Switch', 'Dimmer Switch', 'On/Off Switch', 'Timer Switch', 'On/Off Relay', 'GFCI Outlet', 'Outlet', 'Networking', 'Coax', 'Other'];
		let best = members[0];
		let bestIdx = priority.length;
		for (const m of members) {
			const rt = m.fields['Receptacle Type'] as string || 'Other';
			const idx = priority.indexOf(rt);
			if (idx !== -1 && idx < bestIdx) { best = m; bestIdx = idx; }
		}
		return getDeviceMarker(best, 'receptacle');
	}

	// Track which group is expanded (tap to show members)
	let expandedGroup: string | null = $state(null);
	let popoverMinimized: boolean = $state(false); // Hide popover but keep wire-run lines visible
	let selectedLoadId: number | null = $state(null);
	let expandedCluster: string | null = $state(null);
	let selectedPanelMarkerId: number | null = $state(null);
	let expandedFixtureLoadId: number | null = $state(null); // load whose fixtures are fanned out

	// Wire-run lines: show electrical connections when panel/load/receptacle selected
	type WireRun = { x1: number; y1: number; x2: number; y2: number; hop: 'circuit' | 'load' | 'traveler'; dashed?: boolean; curveOffset?: number };
	type GhostPanel = { name: string; floor: string } | null;
	type WireRunData = { lines: WireRun[]; ghostPanel: GhostPanel; relevantMarkerIds: Set<string>; relevantRecIds: Set<number> };
	let tracingCircuitId: number | null = $state(null); // full-trace mode from popover button

	function getWireRunData(): WireRunData {
		const recGroups = getReceptacleGroupsForFloor();
		const lines: WireRun[] = [];
		const drawnGroupKeys = new Set<string>();
		let ghostPanel: GhostPanel = null;
		const relevantMarkerIds = new Set<string>();
		const relevantRecIds = new Set<number>();

		// Helper: get a receptacle's circuit ID
		// Helper: get receptacle position (uses group position if in a gang)
		function getRecPos(rec: V3Record): { x: number; y: number; key: string } | null {
			if (rec.fields.Floorplan_X == null || rec.fields.Floorplan_Id !== selectedFloorId) return null;
			const group = recGroups.find(g => g.members.some(m => m.id === rec.id));
			if (!group) return { x: rec.fields.Floorplan_X as number, y: rec.fields.Floorplan_Y as number, key: `solo-${rec.id}` };
			// For multi-member gangs, offset x per member so lines target specific positions in the faceplate
			if (group.members.length > 1) {
				const idx = group.members.findIndex(m => m.id === rec.id);
				const count = group.members.length;
				// Spread ~1.2% per member centered on group position
				const spread = 0.012;
				const offsetX = (idx - (count - 1) / 2) * spread;
				return { x: group.x + offsetX, y: group.y, key: group.key };
			}
			return { x: group.x, y: group.y, key: group.key };
		}

		// Helper: find panel position — on this floor or set ghost if off-floor
		function findPanelPos(circuitIds: Set<number>): { x: number; y: number } | null {
			for (const circuit of allCircuits) {
				if (!circuitIds.has(circuit.id)) continue;
				const p = circuit.fields.Panel as { id: number } | undefined;
				if (!p) continue;
				const panel = allPanels.find(pp => pp.id === p.id);
				if (!panel || panel.fields.Floorplan_X == null) continue;
				if (panel.fields.Floorplan_Id === selectedFloorId) {
					return { x: panel.fields.Floorplan_X as number, y: panel.fields.Floorplan_Y as number };
				} else {
					// Panel on different floor — set ghost
					const panelFloor = floorplans.find(f => f.id === panel.fields.Floorplan_Id);
					ghostPanel = { name: (panel.fields.Name as string) || 'Panel', floor: (panelFloor?.fields.Floor as string) || 'Other floor' };
					return null;
				}
			}
			return null;
		}

		// Helper: draw panel → recs → loads for a set of circuit IDs
		function drawCircuitRuns(circuitIds: Set<number>) {
			const panelPos = findPanelPos(circuitIds);
			// Ghost badge position — center-bottom of the badge element (at left:3% top:3%, ~10% wide, ~3% tall)
			const ghostPos = { x: 0.08, y: 0.055 };

			// Mark the panel as relevant
			if (panelPos || ghostPanel) {
				for (const circuit of allCircuits) {
					if (!circuitIds.has(circuit.id)) continue;
					const p = circuit.fields.Panel as { id: number } | undefined;
					if (p) { relevantMarkerIds.add(`panel-${p.id}`); break; }
				}
			}

			const floorRecs = allReceptacles.filter(r => {
				const cid = getReceptacleCircuitId(r);
				return cid != null && circuitIds.has(cid) && r.fields.Floorplan_X != null && r.fields.Floorplan_Id === selectedFloorId;
			});

			// Track loads found on this floor for fallback ghost→load lines
			const loadsOnFloor: { id: number; x: number; y: number }[] = [];
			let hasRecLines = false;

			for (const rec of floorRecs) {
				const pos = getRecPos(rec);
				if (!pos) continue;
				hasRecLines = true;

				// Mark receptacle group as relevant
				relevantMarkerIds.add(`rec-${pos.key}`);
				relevantRecIds.add(rec.id);

				// Panel → Receptacle (only if panel is on same floor)
				if (panelPos && !drawnGroupKeys.has(pos.key)) {
					drawnGroupKeys.add(pos.key);
					lines.push({ x1: panelPos.x, y1: panelPos.y, x2: pos.x, y2: pos.y, hop: 'circuit' });
				} else if (ghostPanel && !drawnGroupKeys.has(pos.key)) {
					// Ghost panel → Receptacle (dashed line from badge)
					drawnGroupKeys.add(pos.key);
					lines.push({ x1: ghostPos.x, y1: ghostPos.y, x2: pos.x, y2: pos.y, hop: 'circuit', dashed: true });
				}

				// Receptacle → Load
				const loadNameField = rec.fields['Load Name(s)'];
				const loadNames: string[] = typeof loadNameField === 'string'
					? loadNameField.split(',').map(s => s.trim()).filter(Boolean)
					: Array.isArray(loadNameField) ? loadNameField.filter(Boolean) : [];
				for (const name of loadNames) {
					const load = allLoads.find(l => (l.fields.Name as string) === name);
					if (load && load.fields.Floorplan_X != null && load.fields.Floorplan_Id === selectedFloorId) {
						relevantMarkerIds.add(`load-${load.id}`);
						loadsOnFloor.push({ id: load.id, x: load.fields.Floorplan_X as number, y: load.fields.Floorplan_Y as number });
						lines.push({ x1: pos.x, y1: pos.y, x2: load.fields.Floorplan_X as number, y2: load.fields.Floorplan_Y as number, hop: 'load' });
					}
				}
			}

			// Traveler lines: connect switches that share the same load (multi-way switching)
			const loadToRecPositions = new Map<string, { x: number; y: number }[]>();
			for (const rec of floorRecs) {
				const pos = getRecPos(rec);
				if (!pos) continue;
				const loadNameField = rec.fields['Load Name(s)'];
				const loadNames: string[] = typeof loadNameField === 'string'
					? loadNameField.split(',').map(s => s.trim()).filter(Boolean)
					: Array.isArray(loadNameField) ? loadNameField.filter(Boolean) : [];
				for (const name of loadNames) {
					if (!loadToRecPositions.has(name)) loadToRecPositions.set(name, []);
					const positions = loadToRecPositions.get(name)!;
					// Avoid duplicate positions for same group
					if (!positions.some(p => p.x === pos.x && p.y === pos.y)) {
						positions.push({ x: pos.x, y: pos.y });
					}
				}
			}
			// Also check receptacles NOT in this circuit that share a load (multi-way across circuits)
			for (const rec of floorRecs) {
				const loadNameField = rec.fields['Load Name(s)'];
				const loadNames: string[] = typeof loadNameField === 'string'
					? loadNameField.split(',').map(s => s.trim()).filter(Boolean)
					: Array.isArray(loadNameField) ? loadNameField.filter(Boolean) : [];
				for (const name of loadNames) {
					// Find OTHER receptacles on this floor that also control this load
					const siblings = allReceptacles.filter(r => {
						if (floorRecs.includes(r)) return false;
						if (r.fields.Floorplan_X == null || r.fields.Floorplan_Id !== selectedFloorId) return false;
						const lnf = r.fields['Load Name(s)'];
						const names: string[] = typeof lnf === 'string' ? lnf.split(',').map(s => s.trim()) : Array.isArray(lnf) ? lnf : [];
						return names.includes(name);
					});
					for (const sib of siblings) {
						const sibPos = getRecPos(sib);
						if (!sibPos) continue;
						relevantMarkerIds.add(`rec-${sibPos.key}`);
						relevantRecIds.add(sib.id);
						const positions = loadToRecPositions.get(name)!;
						if (!positions.some(p => p.x === sibPos.x && p.y === sibPos.y)) {
							positions.push({ x: sibPos.x, y: sibPos.y });
						}
					}
				}
			}
			// Draw traveler lines between switches sharing a load
			for (const [, positions] of loadToRecPositions) {
				if (positions.length < 2) continue;
				for (let i = 0; i < positions.length - 1; i++) {
					lines.push({ x1: positions[i].x, y1: positions[i].y, x2: positions[i + 1].x, y2: positions[i + 1].y, hop: 'traveler', dashed: true });
				}
			}

			// Fallback: if panel is off-floor and no receptacles on this floor,
			// draw dashed lines from ghost badge directly to loads on this floor
			if (ghostPanel && !hasRecLines) {
				// Find all loads on this floor that belong to any receptacle in these circuits
				for (const circuit of allCircuits) {
					if (!circuitIds.has(circuit.id)) continue;
					const circRecs = allReceptacles.filter(r => getReceptacleCircuitId(r) === circuit.id);
					for (const rec of circRecs) {
						const loadNameField = rec.fields['Load Name(s)'];
						const loadNames: string[] = typeof loadNameField === 'string'
							? loadNameField.split(',').map(s => s.trim()).filter(Boolean)
							: Array.isArray(loadNameField) ? loadNameField.filter(Boolean) : [];
						for (const name of loadNames) {
							const load = allLoads.find(l => (l.fields.Name as string) === name);
							if (load && load.fields.Floorplan_X != null && load.fields.Floorplan_Id === selectedFloorId) {
								relevantMarkerIds.add(`load-${load.id}`);
								lines.push({ x1: ghostPos.x, y1: ghostPos.y, x2: load.fields.Floorplan_X as number, y2: load.fields.Floorplan_Y as number, hop: 'circuit', dashed: true });
							}
						}
					}
				}
			}
		}

		// Mode 1: Specific circuit trace (from popover button or panel circuit click)
		if (tracingCircuitId) {
			drawCircuitRuns(new Set([tracingCircuitId]));
			return { lines, ghostPanel, relevantMarkerIds, relevantRecIds };
		}

		// Mode 2: Panel selected — show all circuits for that panel
		if (selectedPanelMarkerId) {
			const panelCircuits = allCircuits.filter(c => {
				const p = c.fields.Panel as { id: number } | undefined;
				return p && p.id === selectedPanelMarkerId;
			});
			relevantMarkerIds.add(`panel-${selectedPanelMarkerId}`);
			drawCircuitRuns(new Set(panelCircuits.map(c => c.id)));
			return { lines, ghostPanel, relevantMarkerIds, relevantRecIds };
		}

		// Mode 3: Load selected — auto-show immediate connection (Load → Receptacle → Panel)
		if (selectedLoadId) {
			const load = allLoads.find(l => l.id === selectedLoadId);
			if (load && load.fields.Floorplan_X != null && load.fields.Floorplan_Id === selectedFloorId) {
				const loadX = load.fields.Floorplan_X as number;
				const loadY = load.fields.Floorplan_Y as number;
				relevantMarkerIds.add(`load-${load.id}`);
				// Find receptacle(s) that control this load
				const loadName = load.fields.Name as string;
				const connectedRecs = loadName ? allReceptacles.filter(r => {
					const lnf = r.fields['Load Name(s)'];
					const names: string[] = typeof lnf === 'string' ? lnf.split(',').map(s => s.trim()) : Array.isArray(lnf) ? lnf : [];
					return names.includes(loadName);
				}) : [];
				let hasVisibleRec = false;
				for (const rec of connectedRecs) {
					const pos = getRecPos(rec);
					if (!pos) continue;
					hasVisibleRec = true;
					relevantMarkerIds.add(`rec-${pos.key}`);
					relevantRecIds.add(rec.id);
					lines.push({ x1: pos.x, y1: pos.y, x2: loadX, y2: loadY, hop: 'load' });
					// Also show panel → receptacle
					const cid = getReceptacleCircuitId(rec);
					if (cid && !drawnGroupKeys.has(pos.key)) {
						drawnGroupKeys.add(pos.key);
						const panelPos = findPanelPos(new Set([cid]));
						if (panelPos) {
							for (const circuit of allCircuits) {
								if (circuit.id === cid) {
									const p = circuit.fields.Panel as { id: number } | undefined;
									if (p) relevantMarkerIds.add(`panel-${p.id}`);
									break;
								}
							}
							lines.push({ x1: panelPos.x, y1: panelPos.y, x2: pos.x, y2: pos.y, hop: 'circuit' });
						}
					}
				}
				// Fallback: if no receptacles visible on this floor, find circuit and draw ghost line
				if (!hasVisibleRec && connectedRecs.length > 0) {
					const cid = getReceptacleCircuitId(connectedRecs[0]);
					if (cid) {
						findPanelPos(new Set([cid]));
						if (ghostPanel) {
							lines.push({ x1: 0.08, y1: 0.055, x2: loadX, y2: loadY, hop: 'circuit', dashed: true });
						}
					}
				} else if (!hasVisibleRec && connectedRecs.length === 0) {
					// No receptacle at all — check if load has a Receptacle Name field to find circuit
					const recName = load.fields['Receptacle Name'] as string | undefined;
					if (recName) {
						const rec = allReceptacles.find(r => (r.fields.Name as string) === recName);
						if (rec) {
							const cid = getReceptacleCircuitId(rec);
							if (cid) {
								findPanelPos(new Set([cid]));
								if (ghostPanel) {
									lines.push({ x1: 0.08, y1: 0.055, x2: loadX, y2: loadY, hop: 'circuit', dashed: true });
								}
							}
						}
					}
				}
			}
			return { lines, ghostPanel, relevantMarkerIds, relevantRecIds };
		}

		// Mode 4: Receptacle group selected — auto-show upstream (Panel → Rec) and downstream (Rec → Loads)
		if (expandedGroup) {
			const popGroup = recGroups.find(g => g.key === expandedGroup);
			if (popGroup) {
				relevantMarkerIds.add(`rec-${popGroup.key}`);
				for (const rec of popGroup.members) {
					relevantRecIds.add(rec.id);
					const pos = getRecPos(rec);
					if (!pos) continue;
					// Upstream: panel → rec
					const cid = getReceptacleCircuitId(rec);
					if (cid && !drawnGroupKeys.has(`up-${rec.id}`)) {
						drawnGroupKeys.add(`up-${rec.id}`);
						const panelPos = findPanelPos(new Set([cid]));
						if (panelPos) {
							// Mark the panel
							for (const circuit of allCircuits) {
								if (circuit.id === cid) {
									const p = circuit.fields.Panel as { id: number } | undefined;
									if (p) relevantMarkerIds.add(`panel-${p.id}`);
									break;
								}
							}
							lines.push({ x1: panelPos.x, y1: panelPos.y, x2: pos.x, y2: pos.y, hop: 'circuit' });
						}
					}
					// Downstream: rec → loads
					const loadNameField = rec.fields['Load Name(s)'];
					const loadNames: string[] = typeof loadNameField === 'string'
						? loadNameField.split(',').map(s => s.trim()).filter(Boolean)
						: Array.isArray(loadNameField) ? loadNameField.filter(Boolean) : [];
					for (const name of loadNames) {
						const load = allLoads.find(l => (l.fields.Name as string) === name);
						if (load && load.fields.Floorplan_X != null && load.fields.Floorplan_Id === selectedFloorId) {
							relevantMarkerIds.add(`load-${load.id}`);
							lines.push({ x1: pos.x, y1: pos.y, x2: load.fields.Floorplan_X as number, y2: load.fields.Floorplan_Y as number, hop: 'load' });
						}
					}
				}
			}
			return { lines, ghostPanel, relevantMarkerIds, relevantRecIds };
		}

		return { lines, ghostPanel, relevantMarkerIds, relevantRecIds };
	}

	/** Apply curve offsets to wire-run lines that share endpoints (bundled lines).
	 *  Traveler lines always get a slight curve for visual distinction. */
	function applyCurveOffsets(data: WireRunData): WireRunData {
		const lines = data.lines;
		if (lines.length <= 1) {
			// Single line still gets a curve for visual polish
			if (lines.length === 1) {
				const newLines = [{ ...lines[0] }];
				newLines[0].curveOffset = newLines[0].hop === 'traveler' ? 0.04 : 0.025;
				return { ...data, lines: newLines };
			}
			return data;
		}

		// Group lines by nearby endpoints (coarse rounding so gang members cluster together)
		const endpointKey = (x: number, y: number) => `${(x * 10).toFixed(0)},${(y * 10).toFixed(0)}`;
		const startGroups = new Map<string, number[]>();
		const endGroups = new Map<string, number[]>();

		for (let i = 0; i < lines.length; i++) {
			const sk = endpointKey(lines[i].x1, lines[i].y1);
			const ek = endpointKey(lines[i].x2, lines[i].y2);
			if (!startGroups.has(sk)) startGroups.set(sk, []);
			startGroups.get(sk)!.push(i);
			if (!endGroups.has(ek)) endGroups.set(ek, []);
			endGroups.get(ek)!.push(i);
		}

		// Find lines that share a start or end point with others
		const bundledIndices = new Set<number>();
		for (const indices of startGroups.values()) {
			if (indices.length > 1) indices.forEach(i => bundledIndices.add(i));
		}
		for (const indices of endGroups.values()) {
			if (indices.length > 1) indices.forEach(i => bundledIndices.add(i));
		}

		// Assign curve offsets: spread bundled lines perpendicular to their direction
		const processed = new Set<number>();
		const newLines = lines.map((line, i) => ({ ...line }));

		// Process groups sharing start points (gang faceplate lines fan out)
		for (const [, indices] of startGroups) {
			if (indices.length <= 1) continue;
			const spread = 0.035; // strong perpendicular offset for clear separation
			const count = indices.length;
			indices.forEach((idx, rank) => {
				const offset = (rank - (count - 1) / 2) * spread;
				newLines[idx].curveOffset = (newLines[idx].curveOffset || 0) + offset;
				processed.add(idx);
			});
		}

		// Process groups sharing end points (add offset if not already set)
		for (const [, indices] of endGroups) {
			if (indices.length <= 1) continue;
			const spread = 0.035;
			const count = indices.length;
			indices.forEach((idx, rank) => {
				if (!processed.has(idx)) {
					const offset = (rank - (count - 1) / 2) * spread;
					newLines[idx].curveOffset = (newLines[idx].curveOffset || 0) + offset;
				}
			});
		}

		// All lines get a minimum curve for visual clarity (avoid straight lines crossing markers)
		for (let i = 0; i < newLines.length; i++) {
			if (newLines[i].hop === 'traveler') {
				// Traveler lines always get a distinct curve
				if (!newLines[i].curveOffset || Math.abs(newLines[i].curveOffset!) < 0.03) {
					newLines[i].curveOffset = 0.04;
				}
			} else if (!newLines[i].curveOffset) {
				// Non-bundled lines get a visible curve
				newLines[i].curveOffset = (i % 2 === 0 ? 1 : -1) * 0.025;
			}
		}

		return { ...data, lines: newLines };
	}

	/** Snap wire-run line endpoints to cluster visual positions.
	 *  When markers are clustered, their visual position is the cluster center,
	 *  not their raw Floorplan_X/Y. Adjust endpoints accordingly. */
	function snapToClusterPositions(data: WireRunData): WireRunData {
		const clusters = getMarkerClusters();
		if (clusters.length === 0) return data;

		// Build array of raw item positions → rendered positions for proximity matching
		const snapTargets: { rawX: number; rawY: number; renderedX: number; renderedY: number }[] = [];
		for (const cluster of clusters) {
			for (let idx = 0; idx < cluster.items.length; idx++) {
				const item = cluster.items[idx];
				if (expandedCluster === cluster.key) {
					const clusterHasPanel = cluster.items.some(i => i.type === 'panel');
					const fanPositions = getFanPositions(cluster.items.length, clusterHasPanel ? 5 : 3.5);
					const fan = fanPositions[idx];
					snapTargets.push({ rawX: item.x, rawY: item.y, renderedX: cluster.x + fan.dx / 100, renderedY: cluster.y + fan.dy / 100 });
				} else {
					snapTargets.push({ rawX: item.x, rawY: item.y, renderedX: cluster.x, renderedY: cluster.y });
				}
			}
		}

		function findSnap(x: number, y: number): { x: number; y: number } | null {
			for (const t of snapTargets) {
				if (Math.abs(x - t.rawX) < 0.005 && Math.abs(y - t.rawY) < 0.005) {
					return { x: t.renderedX, y: t.renderedY };
				}
			}
			return null;
		}

		const newLines = data.lines.map(line => {
			const newLine = { ...line };
			const startSnap = findSnap(line.x1, line.y1);
			if (startSnap) { newLine.x1 = startSnap.x; newLine.y1 = startSnap.y; }
			const endSnap = findSnap(line.x2, line.y2);
			if (endSnap) { newLine.x2 = endSnap.x; newLine.y2 = endSnap.y; }
			return newLine;
		});

		return { ...data, lines: newLines };
	}

	// Reactive wire-run data — accessible to both SVG overlay and marker dimming
	const wireRunActive = $derived(viewLayer === 'power' && (!!selectedPanelMarkerId || !!tracingCircuitId || !!selectedLoadId || !!expandedGroup));
	const wireRunData = $derived.by(() => wireRunActive ? applyCurveOffsets(snapToClusterPositions(getWireRunData())) : null);

	// Circuit labels to display near the panel marker when wire runs are active
	const wireRunCircuitLabels = $derived.by(() => {
		if (!wireRunData || wireRunData.lines.length === 0) return [];
		const labels: string[] = [];
		// Collect circuit names involved in visible wire runs
		if (tracingCircuitId) {
			const c = allCircuits.find(ci => ci.id === tracingCircuitId);
			if (c) labels.push((c.fields.Name as string) || `Circuit #${c.id}`);
		} else if (selectedLoadId) {
			const load = allLoads.find(l => l.id === selectedLoadId);
			if (load) {
				const loadName = load.fields.Name as string;
				const connectedRecs = loadName ? allReceptacles.filter(r => {
					const lnf = r.fields['Load Name(s)'];
					const names: string[] = typeof lnf === 'string' ? lnf.split(',').map(s => s.trim()) : Array.isArray(lnf) ? lnf : [];
					return names.includes(loadName);
				}) : [];
				const circuitIds = new Set<number>();
				for (const rec of connectedRecs) {
					const cLink = rec.fields.Circuit as { id: number } | undefined;
					const cid = cLink?.id ?? (rec.fields.Circuit_id as number | undefined);
					if (cid) circuitIds.add(cid);
				}
				for (const cid of circuitIds) {
					const c = allCircuits.find(ci => ci.id === cid);
					if (c) labels.push((c.fields.Name as string) || `Circuit #${c.id}`);
				}
			}
		} else if (expandedGroup) {
			const recGroups = getReceptacleGroupsForFloor();
			const group = recGroups.find(g => g.key === expandedGroup);
			if (group) {
				const circuitIds = new Set<number>();
				for (const rec of group.members) {
					const cLink = rec.fields.Circuit as { id: number } | undefined;
					const cid = cLink?.id ?? (rec.fields.Circuit_id as number | undefined);
					if (cid) circuitIds.add(cid);
				}
				for (const cid of circuitIds) {
					const c = allCircuits.find(ci => ci.id === cid);
					if (c) labels.push((c.fields.Name as string) || `Circuit #${c.id}`);
				}
			}
		}
		return labels;
	});

	type NetworkRunLine = { x1: number; y1: number; x2: number; y2: number; dashed?: boolean; sourceLoadId?: number };
	type GhostNetworkBadge = { loadId: number; name: string; floor: string; x: number; y: number };
	type NetworkRunData = { lines: NetworkRunLine[]; ghostBadges: GhostNetworkBadge[] };

	function snapNetworkRunDataToClusterPositions(data: NetworkRunData): NetworkRunData {
		const clusters = getMarkerClusters();
		if (clusters.length === 0) return data;

		// Build loadId → rendered position map
		const loadIdToPos = new Map<number, { x: number; y: number }>();
		for (const cluster of clusters) {
			for (let idx = 0; idx < cluster.items.length; idx++) {
				const item = cluster.items[idx];
				if (item.type === 'load' && item.record) {
					if (expandedCluster === cluster.key) {
						const clusterHasPanel = cluster.items.some(i => i.type === 'panel');
						const fanPositions = getFanPositions(cluster.items.length, clusterHasPanel ? 5 : 3.5);
						const fan = fanPositions[idx];
						loadIdToPos.set(item.record.id, { x: cluster.x + fan.dx / 100, y: cluster.y + fan.dy / 100 });
					} else {
						loadIdToPos.set(item.record.id, { x: cluster.x, y: cluster.y });
					}
				}
			}
		}

		// Also map raw positions for non-load items
		const posToCluster = new Map<string, { x: number; y: number }>();
		for (const cluster of clusters) {
			for (let idx = 0; idx < cluster.items.length; idx++) {
				const item = cluster.items[idx];
				const key = `${item.x.toFixed(3)},${item.y.toFixed(3)}`;
				if (expandedCluster === cluster.key) {
					const clusterHasPanel = cluster.items.some(i => i.type === 'panel');
					const fanPositions = getFanPositions(cluster.items.length, clusterHasPanel ? 5 : 3.5);
					const fan = fanPositions[idx];
					posToCluster.set(key, { x: cluster.x + fan.dx / 100, y: cluster.y + fan.dy / 100 });
				} else {
					posToCluster.set(key, { x: cluster.x, y: cluster.y });
				}
			}
		}

		// Snap lines — use sourceLoadId when available, fall back to position matching
		const snappedLines = data.lines.map((line) => {
			const snapped = { ...line };
			if (line.sourceLoadId) {
				const pos = loadIdToPos.get(line.sourceLoadId);
				if (pos) { snapped.x1 = pos.x; snapped.y1 = pos.y; }
			} else {
				const start = posToCluster.get(`${line.x1.toFixed(3)},${line.y1.toFixed(3)}`);
				if (start) { snapped.x1 = start.x; snapped.y1 = start.y; }
			}
			const end = posToCluster.get(`${line.x2.toFixed(3)},${line.y2.toFixed(3)}`);
			if (end) { snapped.x2 = end.x; snapped.y2 = end.y; }
			return snapped;
		});

		// Snap and deduplicate ghost badges, stacking vertically
		const uniqueGhosts: GhostNetworkBadge[] = [];
		const ghostSet = new Set<string>();
		for (const ghost of data.ghostBadges) {
			// Deduplicate by name+floor (collapse identical ghosts)
			const dedupKey = `${ghost.name}|${ghost.floor}`;
			if (ghostSet.has(dedupKey)) continue;
			ghostSet.add(dedupKey);

			// Snap ghost position relative to its source load's rendered position
			const loadPos = loadIdToPos.get(ghost.loadId);
			const baseX = loadPos ? loadPos.x + 0.055 : ghost.x;
			const baseY = loadPos ? loadPos.y - 0.055 : ghost.y;
			// Stack multiple badges vertically (each ~3.5% higher)
			const stackOffset = uniqueGhosts.length * 0.04;
			const snappedGhost = { ...ghost, x: Math.min(baseX, 0.96), y: Math.max(baseY - stackOffset, 0.02) };
			uniqueGhosts.push(snappedGhost);
		}

		// Update dashed ghost lines to point at their snapped ghost badge
		// Badge uses -translate-y-full so its bottom edge is at ghost.y
		const finalLines = snappedLines.map((line) => {
			if (!line.dashed || !line.sourceLoadId) return line;
			const ghost = uniqueGhosts.find(g => g.loadId === line.sourceLoadId);
			if (ghost) {
				return { ...line, x2: ghost.x, y2: ghost.y };
			}
			// If this line's ghost was deduped away, find the matching ghost by name
			const origGhost = data.ghostBadges.find(g => g.loadId === line.sourceLoadId);
			if (origGhost) {
				const matchGhost = uniqueGhosts.find(g => g.name === origGhost.name && g.floor === origGhost.floor);
				if (matchGhost) return { ...line, x2: matchGhost.x, y2: matchGhost.y };
			}
			return line;
		});

		return { lines: finalLines, ghostBadges: uniqueGhosts };
	}

	function getNetworkRunData(): NetworkRunData {
		const lines: NetworkRunLine[] = [];
		const ghostBadges: GhostNetworkBadge[] = [];

		for (const load of getLoadsForFloor()) {
			if (load.fields.Floorplan_X == null || load.fields.Floorplan_Y == null) continue;
			const upstream = getNetworkUpstreamRecord(load);
			if (!upstream || upstream.id === load.id) continue;

			const loadX = load.fields.Floorplan_X as number;
			const loadY = load.fields.Floorplan_Y as number;
			const upstreamX = upstream.fields.Floorplan_X as number | null | undefined;
			const upstreamY = upstream.fields.Floorplan_Y as number | null | undefined;
			const upstreamFloorId = upstream.fields.Floorplan_Id as number | null | undefined;

			if (upstreamX != null && upstreamY != null && upstreamFloorId === selectedFloorId) {
					lines.push({ x1: loadX, y1: loadY, x2: upstreamX, y2: upstreamY, sourceLoadId: load.id });
				continue;
			}

			const badgeX = Math.min(loadX + 0.055, 0.96);
			const badgeY = Math.max(loadY - 0.055, 0.045);
			ghostBadges.push({
				loadId: load.id,
				name: getDisplayName(upstream, 'Load'),
				floor: getLoadFloorLabel(upstream),
				x: badgeX,
				y: badgeY
			});
				lines.push({ x1: loadX, y1: loadY, x2: badgeX, y2: badgeY + 0.012, dashed: true, sourceLoadId: load.id });
		}

		return { lines, ghostBadges };
	}

	const networkRunData = $derived.by(() => viewLayer === 'network' ? snapNetworkRunDataToClusterPositions(getNetworkRunData()) : null);

	// Proximity clustering: group markers within 3% of each other, ONLY if same room
	// Always includes all layers for clustering accuracy; hidden items get a `hidden` flag
	type MarkerItem = { id: string; type: 'room' | 'load' | 'receptacle-group' | 'panel'; x: number; y: number; record?: V3Record; group?: ReceptacleGroup; marker: { icon: string; bg: string }; label: string; areaId?: number | string; hidden?: boolean };
	type MarkerCluster = { key: string; x: number; y: number; items: MarkerItem[]; hiddenCount: number };

	/** Extract CSS color from Tailwind bg class for use in inline styles */
	function bgToColor(bg: string): string {
		const colorMap: Record<string, string> = {
			'bg-purple-500/80': 'rgb(168 85 247)',
			'bg-amber-500/80': 'rgb(245 158 11)',
			'bg-yellow-500/80': 'rgb(234 179 8)',
			'bg-rose-500/80': 'rgb(244 63 94)',
			'bg-pink-500/80': 'rgb(236 72 153)',
			'bg-orange-500/80': 'rgb(249 115 22)',
			'bg-red-500/80': 'rgb(239 68 68)',
			'bg-blue-500/80': 'rgb(59 130 246)',
			'bg-emerald-500/80': 'rgb(16 185 129)',
			'bg-violet-500/80': 'rgb(139 92 246)',
			'bg-indigo-500/80': 'rgb(99 102 241)',
			'bg-cyan-500/80': 'rgb(6 182 212)',
			'bg-teal-500/80': 'rgb(20 184 166)',
			'bg-sky-500/80': 'rgb(14 165 233)',
			'bg-slate-500/80': 'rgb(100 116 139)',
			'bg-slate-600/80': 'rgb(71 85 105)',
			'bg-amber-500': 'rgb(245 158 11)',
		};
		return colorMap[bg] || 'rgb(148 163 184)';
	}



	/** Assign colors to dot positions based on fan-out angles.
	 * Maps each cluster item's fan-out direction to the nearest SVG dot position,
	 * so dots visually hint where expanded markers will appear.
	 * Uses ALL items (including hidden) for positions to match actual fan-out layout. */
	function getDotColors(cluster: MarkerCluster): string[] {
		const empty = 'rgb(255 255 255 / 0.3)';
		const roomColor = 'rgb(168 85 247 / 0.9)';
		const result = Array(7).fill(empty);

		const allItems = cluster.items;
		const fanPos = getFanPositions(allItems.length);
		// Outer ring dot angles in degrees (index 1-6)
		const ringAngles = [270, 330, 30, 90, 150, 210];

		for (let i = 0; i < allItems.length; i++) {
			const item = allItems[i];
			if (item.hidden) continue; // skip hidden items' colors but their position is still consumed
			const fan = fanPos[i];
			const color = item.type === 'room' ? roomColor : bgToColor(item.marker.bg);

			if (fan.dx === 0 && fan.dy === 0) {
				result[0] = color;
			} else {
				let angle = Math.atan2(fan.dy, fan.dx) * (180 / Math.PI);
				if (angle < 0) angle += 360;

				let bestIdx = 1;
				let bestDist = 360;
				for (let r = 0; r < 6; r++) {
					let diff = Math.abs(angle - ringAngles[r]);
					if (diff > 180) diff = 360 - diff;
					if (diff < bestDist) { bestDist = diff; bestIdx = r + 1; }
				}
				if (result[bestIdx] === empty) {
					result[bestIdx] = color;
				} else {
					const order = [bestIdx, ...([1,2,3,4,5,6].filter(x => x !== bestIdx))];
					for (const slot of order) {
						if (result[slot] === empty) { result[slot] = color; break; }
					}
				}
			}
		}

		return result;
	}

	/** Get gradient stops for ring style, aligned with fan-out positions.
	 * Uses ALL items for angle calculation to match actual expansion layout. */
	function getGradientStops(cluster: MarkerCluster): { rotation: number; stops: string } {
		const allItems = cluster.items;
		const fanPos = getFanPositions(allItems.length);
		const roomColor = 'rgb(168 85 247)';

		// Build angle→color pairs for visible items
		const segments: { angle: number; color: string }[] = [];
		for (let i = 0; i < allItems.length; i++) {
			if (allItems[i].hidden) continue;
			const fan = fanPos[i];
			const color = allItems[i].type === 'room' ? roomColor : bgToColor(allItems[i].marker.bg);
			// atan2 → CSS conic angle (0=top, clockwise)
			let angle = Math.atan2(fan.dy, fan.dx) * (180 / Math.PI) + 90;
			if (angle < 0) angle += 360;
			segments.push({ angle, color });
		}

		if (segments.length === 0) return { rotation: 0, stops: 'rgb(148 163 184 / 0.6) 0deg 360deg' };
		if (segments.length === 1) return { rotation: 0, stops: `${segments[0].color} 0deg 360deg` };

		// Sort by angle
		segments.sort((a, b) => a.angle - b.angle);

		// Compute boundaries at midpoints between adjacent item angles
		const n = segments.length;
		const boundaries: number[] = [];
		for (let i = 0; i < n; i++) {
			const curr = segments[i].angle;
			const next = segments[(i + 1) % n].angle;
			// Midpoint, handling wrap-around
			const gap = ((next - curr) + 360) % 360;
			const mid = (curr + gap / 2) % 360;
			boundaries.push(mid);
		}

		// Build stops: each segment runs from prev boundary to its boundary
		// Use `from Xdeg` to rotate so first segment's start is at 0deg in the CSS
		const firstStart = boundaries[(n - 1)]; // boundary before first segment
		const rotation = firstStart;

		const stops = segments.map((seg, i) => {
			const prevBoundary = boundaries[(i - 1 + n) % n];
			const currBoundary = boundaries[i];
			// Convert to relative degrees from rotation start
			let start = ((prevBoundary - rotation) % 360 + 360) % 360;
			let end = ((currBoundary - rotation) % 360 + 360) % 360;
			if (end <= start) end += 360;
			return `${seg.color} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`;
		}).join(', ');

		return { rotation, stops };
	}

	function getMarkerClusters(): MarkerCluster[] {
		void markerTick; // reactive dependency — re-run when markers move
		const PROXIMITY = 0.03; // 3% threshold
		const items: MarkerItem[] = [];

		// Always gather all layers for clustering; mark visibility
		if (selectedFloorplan) {
			for (const area of getAreasForFloor(selectedFloorplan)) {
				const pos = getAreaPosition(area);
				if (pos) items.push({ id: `room-${area.id}`, type: 'room', x: pos.x, y: pos.y, record: area, marker: { icon: 'mdi:home-outline', bg: 'bg-indigo-500/80' }, label: (area.fields.Name as string) || 'Room', areaId: area.id, hidden: !visibleLayers.rooms });
			}
		}
		for (const load of getLoadsForFloor()) {
			const m = getDeviceMarker(load, 'load');
			const loadAreaId = load.fields.Area_id || (load.fields.Area as any)?.id;
			const deviceType = load.fields['Device Type'] as string | undefined;
			const networkRole = load.fields.Network_Role as string | undefined;
			// Hidden logic: layer off, type filter active and not matching, network mode hides non-network loads, permanent filter
			let loadHidden = !visibleLayers.loads;
			if (!loadHidden && loadTypeFilter && deviceType && !loadTypeFilter.has(deviceType)) loadHidden = true;
			if (!loadHidden && loadTypeFilter && !deviceType) loadHidden = true; // no type = hidden when filter active
			if (!loadHidden && viewLayer === 'network' && !networkRole) loadHidden = true;
			if (!loadHidden && filterPermanentOnly && !(load.fields.Permanent as boolean)) loadHidden = true;
			items.push({ id: `load-${load.id}`, type: 'load', x: load.fields.Floorplan_X as number, y: load.fields.Floorplan_Y as number, record: load, marker: m, label: getDisplayName(load, 'Load'), areaId: loadAreaId, hidden: loadHidden });
		}
		for (const group of getReceptacleGroupsForFloor()) {
			const recAreaId = group.members[0]?.fields.Area_id || group.members[0]?.fields.AreaId;
			const recType = group.members[0]?.fields['Receptacle Type'] as string | undefined;
			// Hidden logic: layer off, type filter, network mode hides non-networking receptacles
			let recHidden = !visibleLayers.receptacles;
			if (!recHidden && receptacleTypeFilter && recType && !receptacleTypeFilter.has(recType)) recHidden = true;
			if (!recHidden && receptacleTypeFilter && !recType) recHidden = true;
			if (!recHidden && viewLayer === 'network' && recType !== 'Networking') recHidden = true;
			if (!recHidden && filterPermanentOnly) {
				const allPermanent = group.members.every(m => m.fields.Permanent as boolean);
				if (!allPermanent) recHidden = true;
			}
			items.push({ id: `rec-${group.key}`, type: 'receptacle-group', x: group.x, y: group.y, group, marker: group.primaryMarker, label: group.members.length > 1 ? `${group.members.length}-gang box` : getDisplayName(group.members[0], 'Receptacle'), areaId: recAreaId as any, hidden: recHidden });
		}
		// Panels placed on this floor
		for (const panel of allPanels) {
			if (panel.fields.Floorplan_X != null && panel.fields.Floorplan_Y != null && panel.fields.Floorplan_Id === selectedFloorId) {
				items.push({ id: `panel-${panel.id}`, type: 'panel', x: panel.fields.Floorplan_X as number, y: panel.fields.Floorplan_Y as number, record: panel, marker: { icon: 'mdi:transmission-tower', bg: 'bg-amber-500/90' }, label: (panel.fields.Name as string) || 'Panel', hidden: !visibleLayers.panels });
			}
		}

		// Cluster by proximity — only merge items from the same room
		const clusters: MarkerCluster[] = [];
		const assigned = new Set<string>();

		for (const item of items) {
			if (assigned.has(item.id)) continue;
			const cluster: MarkerItem[] = [item];
			assigned.add(item.id);

			for (const other of items) {
				if (assigned.has(other.id)) continue;
				if (Math.abs(item.x - other.x) < PROXIMITY && Math.abs(item.y - other.y) < PROXIMITY) {
					// Only cluster if same room (or one is the room marker itself for that area)
					// Panels cluster with any nearby item regardless of room (shared infrastructure)
					const oneIsPanel = item.type === 'panel' || other.type === 'panel';
					const sameRoom = item.areaId && other.areaId && String(item.areaId) === String(other.areaId);
					const oneIsRoom = (item.type === 'room' && String(item.areaId) === String(other.areaId)) ||
						(other.type === 'room' && String(other.areaId) === String(item.areaId));
					if (oneIsPanel || sameRoom || oneIsRoom) {
						cluster.push(other);
						assigned.add(other.id);
					}
				}
			}

			// Filter to only visible items for display; count hidden
			const visibleItems = cluster.filter(i => !i.hidden);
			const hiddenCount = cluster.length - visibleItems.length;
			if (visibleItems.length === 0) continue; // All items hidden — skip this cluster

			// Use panel or room marker position as anchor (stable reference) or first item
			const anchor = cluster.find(i => i.type === 'panel') || cluster.find(i => i.type === 'room') || visibleItems[0];
			const cx = anchor.x;
			const cy = anchor.y;
			// Sort: panels first (for rendering priority), rooms last (bottom position in fan-out)
			visibleItems.sort((a, b) => {
				if (a.type === 'panel') return -1;
				if (b.type === 'panel') return 1;
				if (a.type === 'room') return 1;
				if (b.type === 'room') return -1;
				return 0;
			});
			clusters.push({ key: visibleItems.map(i => i.id).join('+'), x: cx, y: cy, items: visibleItems, hiddenCount });
		}
		return clusters;
	}

	// Detect multi-way switch count for a receptacle group
	function getMultiWayCount(group: { members: V3Record[] }): number {
		let maxWay = 0;
		for (const member of group.members) {
			const lnf = member.fields['Load Name(s)'];
			const loadNames: string[] = typeof lnf === 'string' ? lnf.split(',').map(s => s.trim()).filter(Boolean) : Array.isArray(lnf) ? lnf.filter(Boolean) : [];
			for (const name of loadNames) {
				const siblings = allReceptacles.filter(r => r.id !== member.id && (() => { const rlnf = r.fields['Load Name(s)']; const rnames: string[] = typeof rlnf === 'string' ? rlnf.split(',').map(s => s.trim()) : Array.isArray(rlnf) ? rlnf : []; return rnames.includes(name); })());
				if (siblings.length > 0) maxWay = Math.max(maxWay, siblings.length + 1);
			}
		}
		return maxWay;
	}

	// Detect which existing cluster a position would merge into (same-room only)
	function updateMergeTarget(x: number, y: number) {
		const PROXIMITY = 0.03;
		// Determine the areaId of the item being placed/dragged
		let itemAreaId: string | number | null = null;
		if (placingItem) {
			if (placingItem.type === 'room' && placingItem.areaId) {
				itemAreaId = placingItem.areaId;
			} else if (placingItem.type === 'load' && placingItem.id) {
				const load = allLoads.find(l => l.id === placingItem!.id);
				itemAreaId = load?.fields.Area_id || (load?.fields.Area as any)?.id || null;
			} else if (placingItem.type === 'receptacle' && placingItem.id) {
				const rec = allReceptacles.find(r => r.id === placingItem!.id);
				itemAreaId = (rec?.fields.Area_id || rec?.fields.AreaId || null) as string | number | null;
			}
		} else if (draggingMarker) {
			if (draggingMarker.type === 'room') {
				itemAreaId = draggingMarker.id;
			} else if (draggingMarker.type === 'load') {
				const load = allLoads.find(l => l.id === draggingMarker!.id);
				itemAreaId = load?.fields.Area_id || (load?.fields.Area as any)?.id || null;
			} else if (draggingMarker.type === 'receptacle-group') {
				const group = getReceptacleGroupsForFloor().find(g => g.key === draggingMarker!.id);
				itemAreaId = (group?.members[0]?.fields.Area_id || group?.members[0]?.fields.AreaId || null) as string | number | null;
			}
		}

		if (!itemAreaId) {
			// Even without areaId, check if we're near a panel cluster (panels group with anything)
			const clusters = getMarkerClusters();
			for (const cluster of clusters) {
				if (Math.abs(x - cluster.x) < PROXIMITY && Math.abs(y - cluster.y) < PROXIMITY) {
					if (cluster.items.some(i => i.type === 'panel')) {
						mergeTargetKey = cluster.key;
						return;
					}
				}
			}
			mergeTargetKey = null;
			return;
		}

		const clusters = getMarkerClusters();
		for (const cluster of clusters) {
			if (Math.abs(x - cluster.x) < PROXIMITY && Math.abs(y - cluster.y) < PROXIMITY) {
				// Panel clusters accept any item regardless of room
				const hasPanel = cluster.items.some(i => i.type === 'panel');
				if (hasPanel) {
					mergeTargetKey = cluster.key;
					return;
				}
				// Otherwise check if cluster belongs to same room
				const clusterAreaId = cluster.items[0]?.areaId;
				if (clusterAreaId && String(itemAreaId) === String(clusterAreaId)) {
					mergeTargetKey = cluster.key;
					return;
				}
			}
		}
		mergeTargetKey = null;
	}

	// Radial fan-out positions (evenly distributed around center)
	// Room item is sorted last in cluster items → last position is always bottom
	function getFanPositions(count: number, radius: number = 3.5): { dx: number; dy: number }[] {
		if (count === 1) return [{ dx: 0, dy: 0 }];
		if (count === 2) return [{ dx: 0, dy: -radius }, { dx: 0, dy: radius }]; // top + bottom
		// Distribute evenly, ensuring last index = bottom (pi/2)
		const startAngle = Math.PI / 2 - (2 * Math.PI * (count - 1) / count);
		const positions: { dx: number; dy: number }[] = [];
		for (let i = 0; i < count; i++) {
			const angle = startAngle + (2 * Math.PI * i / count);
			positions.push({ dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius });
		}
		return positions;
	}

	/** Get fixture positions for a load with multiple fixtures.
	 *  Uses Fixture_Positions JSON (absolute x/y coords on floorplan).
	 *  If not yet placed, returns empty (user must place them). */
	function getFixturePositions(load: V3Record): { x: number; y: number }[] {
		const count = (load.fields.Fixture_Count as number) || 1;
		if (count <= 1) return [];

		const posJson = load.fields.Fixture_Positions as string | undefined;
		if (posJson) {
			try {
				const positions = JSON.parse(posJson) as { x: number; y: number }[];
				if (Array.isArray(positions) && positions.length > 0) {
					return positions.slice(0, count);
				}
			} catch { /* invalid JSON, return empty */ }
		}
		return [];
	}

	/** Whether a load should show its fixtures expanded (always-on or user toggled) */
	function isLoadFixtureExpanded(load: V3Record): boolean {
		const count = (load.fields.Fixture_Count as number) || 1;
		if (count <= 1) return false;
		if (load.fields.Display_Mode === 'expanded') return true;
		return expandedFixtureLoadId === load.id;
	}

	// Find gang-mates: other receptacles sharing same physical box location
	function getGangMates(rec: V3Record): V3Record[] {
		const key = getGroupKeyForRec(rec);
		return allReceptacles.filter(r => {
			if (r.id === rec.id) return false;
			return getGroupKeyForRec(r) === key;
		});
	}

	function getGroupKeyForRec(rec: V3Record): string {
		const areaId = (rec.fields.Area_id || rec.fields.AreaId || '') as string;
		const dir = (rec.fields['Loc.Direction'] as string || '').charAt(0);
		const place = (rec.fields['Loc.Placement'] as string || '').charAt(0);
		const recIdx = rec.fields['Loc.Rec.Index'] as number || 0;
		// Index 0 means "unassigned box" — treat as unique (no gang grouping)
		if (!recIdx) return `_solo_${rec.id}`;
		return `${areaId}-${dir}${place}-${recIdx}`;
	}

	function getUnplacedLoads(): V3Record[] {
		// Loads can appear on multiple floors (e.g., can lights span areas)
		// Show loads not yet placed on the CURRENT floor
		return allLoads.filter(l => !(l.fields.Floorplan_X != null && l.fields.Floorplan_Y != null && l.fields.Floorplan_Id === selectedFloorId));
	}

	function getUnplacedReceptacles(): V3Record[] {
		// Receptacles are physical — can only be in one spot (house-wide)
		return allReceptacles.filter(r => !(r.fields.Floorplan_X != null && r.fields.Floorplan_Y != null && r.fields.Floorplan_Id));
	}

	function getDeviceMarker(record: V3Record, type: 'load' | 'receptacle'): { icon: string; bg: string } {
		// Icon override: if record has an Icon field, use it
		const override = record.fields.Icon as string;
		if (override) {
			// Determine bg from type config or use a default
			if (type === 'load') {
				const dt = record.fields['Device Type'] as string || '';
				const cfg = loadTypeConfig[dt];
				return { icon: override, bg: cfg?.markerBg || 'bg-slate-500/80' };
			}
			const rt = record.fields['Receptacle Type'] as string || '';
			const cfg = receptacleTypeConfig[rt];
			return { icon: override, bg: cfg?.markerBg || 'bg-indigo-500/80' };
		}

		if (type === 'load') {
			const dt = record.fields['Device Type'] as string || '';
			const cfg = loadTypeConfig[dt];
			if (cfg) return { icon: cfg.icon, bg: cfg.markerBg };
			// Fallback by keyword
			if (dt.includes('Light')) return { icon: 'mdi:ceiling-light', bg: 'bg-amber-500/80' };
			if (dt.includes('Fan')) return { icon: 'mdi:ceiling-fan-light', bg: 'bg-cyan-500/80' };
			if (dt.includes('Camera')) return { icon: 'mdi:cctv', bg: 'bg-rose-500/80' };
			if (dt.includes('Appliance')) return { icon: 'mdi:dishwasher', bg: 'bg-orange-500/80' };
			return { icon: 'mdi:lightning-bolt', bg: 'bg-orange-500/80' };
		}
		const rt = record.fields['Receptacle Type'] as string || '';
		const cfg = receptacleTypeConfig[rt];
		if (cfg) return { icon: cfg.icon, bg: cfg.markerBg };
		if (rt.includes('Outlet') || rt.includes('GFCI')) return { icon: 'mdi:power-socket-us', bg: 'bg-indigo-500/80' };
		if (rt.includes('Switch') || rt.includes('Dimmer')) return { icon: 'mdi:light-switch', bg: 'bg-slate-500/80' };
		if (rt.includes('Network')) return { icon: 'mdi:ethernet', bg: 'bg-fuchsia-500/80' };
		return { icon: 'mdi:power-plug-outline', bg: 'bg-indigo-500/80' };
	}
</script>

<svelte:window onpaste={handlePaste} onclick={() => { showFloorMenu = null; expandedGroup = null; selectedLoadId = null; expandedFixtureLoadId = null; selectedPanelMarkerId = null; tracingCircuitId = null; }} onkeydown={(e) => { if (e.key === 'Escape') { if (isFullscreen) { toggleFullscreen(); } else if (placingFixture) { placingFixture = null; toast.info('Fixture placement cancelled'); } else if (placingItem) { placingItem = null; previewPos = null; snapGuides = []; mergeTargetKey = null; } } }} />

<div class="max-w-2xl mx-auto space-y-4">
	<!-- Header + Search + Filter row -->
	<div class="space-y-3">
		<div class="flex items-center gap-2.5">
			<Icon icon="lucide:layout-panel-left" width={22} class="text-violet-400" />
			<h1 class="text-xl font-bold text-fg">Rooms & Areas</h1>
		</div>

		<div class="flex items-center gap-2">
			<!-- View toggle -->
			<div class="flex gap-0.5 bg-slate-800/50 rounded-lg p-0.5">
				<button
					onclick={() => { viewMode = 'list'; }}
					class="px-2 py-1 rounded-md text-xs font-medium transition-colors {viewMode === 'list' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'}"
				>
					<Icon icon="mdi:format-list-bulleted" width={14} class="inline -mt-0.5" /> List
				</button>
				<button
						onclick={() => {
							viewMode = 'floorplan';
							// Switch to the floor containing the selected room (if any)
							if (activePanel.areaId) {
								const area = areas.find(a => a.id === activePanel.areaId);
								if (area?.fields.Floorplan_Id) {
									selectedFloorId = area.fields.Floorplan_Id as number;
								}
							}
						}}
					class="px-2 py-1 rounded-md text-xs font-medium transition-colors {viewMode === 'floorplan' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'}"
				>
					<Icon icon="mdi:floor-plan" width={14} class="inline -mt-0.5" /> Plan
				</button>
			</div>
				{#if !isLocked}
					<button
						onclick={() => { showCreateRoom = true; }}
						class="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
						aria-label="Add room"
					>
						<Icon icon="mdi:plus" width={18} />
					</button>
				{/if}
			</div>

		{#if viewMode === 'list'}
		<div class="flex items-center gap-2">
			<!-- Search -->
			<div class="relative flex-1">
				<Icon icon="mdi:magnify" width={15} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Find rooms, receptacles, loads…"
					class="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg pl-8 pr-8 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-border-color"
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
			<!-- Compact filter pills -->
			<div class="flex gap-0.5 bg-slate-800/50 rounded-lg p-0.5 shrink-0">
				{#each [{ key: 'all', label: 'All' }, { key: 'receptacles', label: 'Receptacles' }, { key: 'loads', label: 'Loads' }] as tab}
					{@const active = deviceFilter === tab.key}
					<button
						onclick={() => { deviceFilter = tab.key as typeof deviceFilter; }}
						class="px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-150 {active ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'}"
					>
						{tab.label}
					</button>
				{/each}
			</div>
		</div>
		{/if}
	</div>

	<div class="space-y-4">

	{#if viewMode === 'floorplan'}
		<!-- FLOORPLAN VIEW -->
		<div
			bind:this={floorplanContainerEl}
			class="floorplan-fullscreen-container space-y-3 {isFullscreen ? 'fixed inset-0 z-50 bg-surface-base overflow-hidden p-4 flex flex-col' : ''}"
		>
			<!-- Fullscreen close button -->
			{#if isFullscreen}
				<button
					onclick={() => toggleFullscreen()}
					class="fixed top-3 right-3 z-[60] w-9 h-9 rounded-full bg-slate-800/90 border border-slate-600/60 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700 transition-colors shadow-lg backdrop-blur-sm"
					style="top: max(0.75rem, env(safe-area-inset-top, 0px)); right: max(0.75rem, env(safe-area-inset-right, 0px))"
					title="Exit fullscreen (Esc)"
					aria-label="Exit fullscreen"
				>
					<Icon icon="mdi:fullscreen-exit" width={20} />
				</button>
			{/if}
			<!-- Floor selector (always show when floorplans exist) -->
			{#if floorplans.length > 0}
				<div class="flex gap-1.5 pb-2 items-center flex-wrap {isFullscreen ? 'hidden' : ''}" >
					{#each floorplans as fp, idx}
						{@const active = selectedFloorId === fp.id}
						<div class="relative shrink-0 overflow-visible">
							{#if renamingFloorId === fp.id}
								<!-- Inline rename input -->
								<input
									type="text"
									bind:value={renameFloorValue}
									class="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-white border border-indigo-500 outline-none w-28"
									onkeydown={(e) => { if (e.key === 'Enter') renameFloor(fp.id, renameFloorValue); if (e.key === 'Escape') { renamingFloorId = null; } }}
									onblur={() => { renameFloor(fp.id, renameFloorValue); }}
									autofocus
								/>
							{:else}
								<div class="flex items-center">
									<button
										onclick={() => { selectFloor(fp.id); }}
										ondblclick={() => { renamingFloorId = fp.id; renameFloorValue = (fp.fields.Floor as string) || ''; }}
										class="px-3 py-1.5 rounded-l-lg text-xs font-medium transition-colors {active ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}"
									>
										{fp.fields.Floor || 'Floor'}
									</button>
									<button
										onclick={(e) => { e.stopPropagation(); selectFloor(fp.id); showFloorMenu = showFloorMenu === fp.id ? null : fp.id; }}
										class="py-1.5 px-1.5 rounded-r-lg text-xs transition-colors {active ? 'bg-indigo-700 text-indigo-200 hover:text-white border-l border-indigo-500/40' : 'bg-slate-800 text-slate-500 hover:text-white border-l border-slate-700/50'}"
									>
										<Icon icon="mdi:chevron-down" width={14} />
									</button>
								</div>
							{/if}
							<!-- Dropdown menu -->
							{#if showFloorMenu === fp.id}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="absolute top-full left-0 mt-1.5 bg-slate-800 border border-slate-700/60 rounded-lg shadow-xl z-30 py-1 min-w-[140px] animate-fade-in" onclick={(e) => e.stopPropagation()}>
									<button onclick={() => { renamingFloorId = fp.id; renameFloorValue = (fp.fields.Floor as string) || ''; showFloorMenu = null; }} class="w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white flex items-center gap-2 transition-colors">
										<Icon icon="mdi:pencil-outline" width={14} />Rename
									</button>
									{#if idx > 0}
										<button onclick={() => moveFloor(fp.id, 'left')} class="w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white flex items-center gap-2 transition-colors">
											<Icon icon="mdi:arrow-left" width={14} />Move left
										</button>
									{/if}
									{#if idx < floorplans.length - 1}
										<button onclick={() => moveFloor(fp.id, 'right')} class="w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white flex items-center gap-2 transition-colors">
											<Icon icon="mdi:arrow-right" width={14} />Move right
										</button>
									{/if}
									<div class="border-t border-slate-700/50 my-1"></div>
									<button onclick={() => deleteFloor(fp.id)} class="w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 flex items-center gap-2 transition-colors">
										<Icon icon="mdi:delete-outline" width={14} />Delete
									</button>
								</div>
							{/if}
						</div>
					{/each}
					<!-- Add floor button -->
					<label class="shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800/50 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1 {uploading ? 'opacity-50 pointer-events-none' : ''}">
						<Icon icon="mdi:plus" width={14} />
						<span>Add floor</span>
						<input
							type="file"
							accept="image/*"
							class="hidden"
							onchange={(e) => {
								const file = e.currentTarget.files?.[0];
								if (file) handleFloorplanUpload(file, `Floor ${floorplans.length + 1}`);
							}}
						/>
					</label>
					<!-- Edit markers + zoom + invert (right-aligned) -->
						<div class="ml-auto flex items-center gap-1.5">
							<div class="flex items-center bg-slate-800 rounded-md p-0.5">
								<button
									onclick={() => { viewLayer = 'power'; }}
									class="px-2 py-0.5 rounded text-[10px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.96] {viewLayer === 'power' ? 'bg-amber-500/20 text-amber-300 shadow-[0_0_0_1px_rgba(245,158,11,0.25)]' : 'text-slate-400 hover:text-white'}"
								>
									Power
								</button>
								<button
									onclick={() => { viewLayer = 'network'; }}
									class="px-2 py-0.5 rounded text-[10px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.96] {viewLayer === 'network' ? 'bg-cyan-500/20 text-cyan-300 shadow-[0_0_0_1px_rgba(34,211,238,0.25)]' : 'text-slate-400 hover:text-white'}"
								>
									Network
								</button>
							</div>
							<button
								onclick={() => { editingMarkers = !editingMarkers; if (!editingMarkers) { placingItem = null; expandedCluster = null; expandedGroup = null; selectedLoadId = null; } }}
								class="px-2 py-1 rounded-lg text-[10px] font-medium transition-colors {editingMarkers ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-slate-800 text-slate-400 hover:text-white'}"
							>
								<Icon icon={editingMarkers ? 'mdi:check' : 'mdi:pencil-outline'} width={12} class="inline mr-0.5" />
								{editingMarkers ? 'Done' : 'Edit'}
							</button>
							<button
								onclick={() => toggleFullscreen()}
								class="px-1.5 py-1 rounded-lg text-[10px] font-medium transition-colors bg-slate-800 text-slate-400 hover:text-white"
								title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
								aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
							>
								<Icon icon={isFullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'} width={14} />
							</button>
						</div>
				</div>
			{/if}

			{#if selectedFloorplan && getFloorplanImage(selectedFloorplan)}
				<!-- Layer toggles -->
				{#if !editingMarkers}
					<div class="flex items-center flex-wrap gap-y-1.5 {isFullscreen ? 'hidden' : ''}" >
						<div class="flex gap-1.5 items-center flex-wrap">
							<span class="text-[10px] text-slate-500 mr-1">Layers:</span>
							<button onclick={() => { visibleLayers.rooms = !visibleLayers.rooms; }} class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors {visibleLayers.rooms ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-slate-800/50 text-slate-500 border border-transparent'}">
								Rooms
							</button>
							<!-- Loads: click toggles, chevron opens type filter dropdown -->
							<div class="relative flex items-center">
								<button
									onclick={() => { visibleLayers.loads = !visibleLayers.loads; }}
									class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium transition-colors {visibleLayers.loads ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' : 'bg-slate-800/50 text-slate-500 border border-transparent'}"
								>
									Loads{loadTypeFilter ? ` (${loadTypeFilter.size})` : ''}
									<Icon icon="mdi:chevron-down" width={8} class="ml-1 opacity-60 hover:opacity-100" onclick={(e) => { e.stopPropagation(); loadFilterOpen = !loadFilterOpen; recFilterOpen = false; }} />
								</button>
								{#if loadFilterOpen}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div class="absolute top-full left-0 mt-1 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-2 min-w-[160px] max-h-[240px] overflow-y-auto"
										onclick={(e) => e.stopPropagation()}>
										<button onclick={() => { loadTypeFilter = null; }} class="w-full text-left px-2 py-1 rounded text-[10px] font-medium transition-colors {!loadTypeFilter ? 'bg-orange-500/20 text-orange-300' : 'text-slate-400 hover:text-white hover:bg-slate-700'}">
											Show All
										</button>
										<div class="border-t border-slate-700 my-1"></div>
										{#each Object.entries(loadTypeConfig) as [key, cfg]}
											<button onclick={() => {
												if (!loadTypeFilter) loadTypeFilter = new Set([key]);
												else if (loadTypeFilter.has(key)) { loadTypeFilter.delete(key); loadTypeFilter = loadTypeFilter.size === 0 ? null : new Set(loadTypeFilter); }
												else { loadTypeFilter.add(key); loadTypeFilter = new Set(loadTypeFilter); }
											}} class="w-full text-left px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1.5 {loadTypeFilter?.has(key) ? 'bg-orange-500/10 text-orange-300' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}">
												<Icon icon={cfg.icon} width={11} class="shrink-0" />
												{cfg.label}
												{#if loadTypeFilter?.has(key)}<Icon icon="mdi:check" width={10} class="ml-auto text-orange-400" />{/if}
											</button>
										{/each}
									</div>
								{/if}
							</div>
							<!-- Receptacles: same pattern -->
							<div class="relative flex items-center">
								<button
									onclick={() => { visibleLayers.receptacles = !visibleLayers.receptacles; }}
									class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium transition-colors {visibleLayers.receptacles ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-slate-800/50 text-slate-500 border border-transparent'}"
								>
									Receptacles{receptacleTypeFilter ? ` (${receptacleTypeFilter.size})` : ''}
									<Icon icon="mdi:chevron-down" width={8} class="ml-1 opacity-60 hover:opacity-100" onclick={(e) => { e.stopPropagation(); recFilterOpen = !recFilterOpen; loadFilterOpen = false; }} />
								</button>
								{#if recFilterOpen}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div class="absolute top-full left-0 mt-1 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-2 min-w-[160px] max-h-[240px] overflow-y-auto"
										onclick={(e) => e.stopPropagation()}>
										<button onclick={() => { receptacleTypeFilter = null; }} class="w-full text-left px-2 py-1 rounded text-[10px] font-medium transition-colors {!receptacleTypeFilter ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-white hover:bg-slate-700'}">
											Show All
										</button>
										<div class="border-t border-slate-700 my-1"></div>
										{#each Object.entries(receptacleTypeConfig) as [key, cfg]}
											<button onclick={() => {
												if (!receptacleTypeFilter) receptacleTypeFilter = new Set([key]);
												else if (receptacleTypeFilter.has(key)) { receptacleTypeFilter.delete(key); receptacleTypeFilter = receptacleTypeFilter.size === 0 ? null : new Set(receptacleTypeFilter); }
												else { receptacleTypeFilter.add(key); receptacleTypeFilter = new Set(receptacleTypeFilter); }
											}} class="w-full text-left px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1.5 {receptacleTypeFilter?.has(key) ? 'bg-indigo-500/10 text-indigo-300' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}">
												<Icon icon={cfg.icon} width={11} class="shrink-0" />
												{cfg.label}
												{#if receptacleTypeFilter?.has(key)}<Icon icon="mdi:check" width={10} class="ml-auto text-indigo-400" />{/if}
											</button>
										{/each}
									</div>
								{/if}
							</div>
							<button onclick={() => { visibleLayers.panels = !visibleLayers.panels; }} class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors {visibleLayers.panels ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-slate-800/50 text-slate-500 border border-transparent'}">
								Panels
							</button>
							<!-- Permanent filter -->
							<button onclick={() => { filterPermanentOnly = !filterPermanentOnly; }} class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors {filterPermanentOnly ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800/50 text-slate-500'}" use:tooltip={'Only show permanent/hardwired devices'}>
								<Icon icon="mdi:pin" width={10} class="inline mr-0.5" />Perm
							</button>
						</div>
						<div class="flex gap-1.5 items-center ml-auto">
							<button
								onclick={() => { invertFloorplan = !invertFloorplan; }}
								class="px-1 py-0.5 rounded text-[9px] transition-colors {invertFloorplan ? 'bg-slate-600 text-white' : 'bg-slate-800/50 text-slate-500 hover:text-white'}"
								title="Invert floorplan colors"
							>
								<Icon icon="mdi:invert-colors" width={11} />
							</button>
							{#if floorplanScale > 1}
								<span class="text-[9px] text-slate-400">{Math.round(floorplanScale * 100)}%</span>
							{/if}
							<span class="text-[9px] text-slate-600 mx-1">|</span>
							<span class="text-[10px] text-slate-500">Clusters:</span>
							{#each [{ id: 'dots', label: 'Dots' }, { id: 'gradient', label: 'Ring' }] as style}
								<button onclick={() => { clusterStyle = style.id as any; }} class="px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors {clusterStyle === style.id ? 'bg-white/10 text-white border border-white/20' : 'bg-slate-800/50 text-slate-500 hover:text-slate-300'}">
									{style.label}
								</button>
							{/each}
						</div>
					</div>
				{/if}

					<!-- Floorplan image with markers -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="relative {isFullscreen ? 'flex-1 min-h-0 overflow-auto flex justify-center items-start' : ''}">
						<div
							class="relative rounded-xl overflow-hidden border bg-slate-800/30 {editingMarkers ? 'border-amber-500/40 cursor-crosshair' : 'border-slate-700/50'} {isFullscreen ? 'w-fit max-w-full' : ''}"
						style="touch-action: none"
						onwheel={handleFloorplanWheel}
						ontouchstart={handleTouchStart}
						ontouchmove={handleTouchMove}
						ontouchend={handleTouchEnd}
						onpointerdown={handlePanStart}
						onpointermove={(e) => { handleDragMove(e); handlePanMove(e); }}
						onpointerup={(e) => { handleDragEnd(); handlePanEnd(); }}
						onclick={handleFloorplanClick}
						onmousemove={handlePlacingMouseMove}
						onmouseleave={() => { previewPos = null; snapGuides = []; mergeTargetKey = null; }}
						role="region"
						aria-label="Interactive floorplan"
					>
						<div style="transform: scale({floorplanScale}) translate({floorplanTranslate.x / floorplanScale}px, {floorplanTranslate.y / floorplanScale}px); transform-origin: center; transition: {isPanning || isTouchZooming ? 'none' : 'transform 0.15s ease-out'}">
							<!-- Grid stacks both transitioning elements in same cell -->
							<div class="grid [&>*]:[grid-area:1/1] {isFullscreen ? 'justify-items-center' : ''}">
							{#key selectedFloorId}
							<div class="relative {isFullscreen ? 'w-fit' : ''}" in:fade={{ duration: 250, delay: 80 }} out:fade={{ duration: 150 }}>
							<img
								src={getFloorplanImage(selectedFloorplan)}
								alt="Floorplan - {selectedFloorplan.fields.Floor}"
								class="{isFullscreen ? '' : 'w-full'} h-auto select-none"
								style="{invertFloorplan ? 'filter: invert(1); ' : ''}{isFullscreen ? 'max-height: calc(100vh - 3rem); max-width: 100%; width: auto;' : ''}"
								draggable="false"
							/>
							<!-- Snap alignment guides -->
							{#if (placingItem || placingFixture || draggingMarker || draggingFixture) && snapGuides.length > 0}
								{#each snapGuides as guide}
									{#if guide.type === 'x'}
										<div class="absolute top-0 bottom-0 pointer-events-none" style="left: {guide.value * 100}%; width: 1px; background: repeating-linear-gradient(to bottom, rgba(99,102,241,0.7) 0px, rgba(99,102,241,0.7) 4px, transparent 4px, transparent 8px);"></div>
									{:else}
										<div class="absolute left-0 right-0 pointer-events-none" style="top: {guide.value * 100}%; height: 1px; background: repeating-linear-gradient(to right, rgba(99,102,241,0.7) 0px, rgba(99,102,241,0.7) 4px, transparent 4px, transparent 8px);"></div>
									{/if}
								{/each}
							{/if}
							<!-- Placement preview dot -->
							{#if (placingItem || placingFixture) && previewPos}
								<div class="absolute w-5 h-5 rounded-full border-2 border-indigo-400 bg-indigo-500/30 pointer-events-none -translate-x-1/2 -translate-y-1/2 z-50" style="left: {previewPos.x * 100}%; top: {previewPos.y * 100}%"></div>
								{#if mergeTargetKey}
									<div class="absolute pointer-events-none -translate-x-1/2 text-[9px] font-medium text-indigo-300 bg-slate-900/90 px-1.5 py-0.5 rounded whitespace-nowrap backdrop-blur-sm z-50" style="left: {previewPos.x * 100}%; top: calc({previewPos.y * 100}% + 14px)">Group markers</div>
								{/if}
							{/if}
							<!-- Focus overlay when a cluster is expanded -->
							{#if expandedCluster}
								<div class="absolute inset-0 bg-black/40 pointer-events-none transition-opacity duration-200 z-[1]"></div>
							{/if}
							<!-- Wire-run lines (panel/load/receptacle selected or tracing) -->
							{#if wireRunData && (wireRunData.lines.length > 0 || wireRunData.ghostPanel)}
								<div class="absolute inset-0 bg-black/30 pointer-events-none transition-opacity duration-200 z-[1]"></div>
								<svg class="absolute inset-0 w-full h-full pointer-events-none z-[2]" viewBox="0 0 100 100" preserveAspectRatio="none" style="overflow: visible">
									{#each wireRunData.lines as run}
										{@const hasOffset = run.curveOffset && Math.abs(run.curveOffset) > 0.001}
										{#if hasOffset}
											{@const mx = (run.x1 + run.x2) / 2}
											{@const my = (run.y1 + run.y2) / 2}
											{@const dx = run.x2 - run.x1}
											{@const dy = run.y2 - run.y1}
											{@const len = Math.sqrt(dx * dx + dy * dy) || 0.001}
											{@const nx = -dy / len}
											{@const ny = dx / len}
											{@const cappedOffset = run.curveOffset!}
											{@const cx = (mx + nx * cappedOffset) * 100}
											{@const cy = (my + ny * cappedOffset) * 100}
											<path
												d="M {run.x1 * 100} {run.y1 * 100} Q {cx} {cy} {run.x2 * 100} {run.y2 * 100}"
												fill="none"
												stroke={run.hop === 'traveler' ? 'rgba(34, 211, 238, 0.8)' : run.dashed ? 'rgba(245, 158, 11, 0.9)' : run.hop === 'circuit' ? 'rgba(251, 191, 36, 0.85)' : 'rgba(251, 191, 36, 0.7)'}
												stroke-width={run.hop === 'traveler' ? 0.25 : run.dashed ? 0.35 : run.hop === 'circuit' ? 0.35 : 0.28}
												stroke-linecap="round"
												stroke-dasharray={run.hop === 'traveler' ? '0.7 0.4' : run.dashed ? '1.1 0.7' : 'none'}
											/>
										{:else}
											<line
												x1={run.x1 * 100} y1={run.y1 * 100}
												x2={run.x2 * 100} y2={run.y2 * 100}
												stroke={run.hop === 'traveler' ? 'rgba(34, 211, 238, 0.8)' : run.dashed ? 'rgba(245, 158, 11, 0.9)' : run.hop === 'circuit' ? 'rgba(251, 191, 36, 0.85)' : 'rgba(251, 191, 36, 0.7)'}
												stroke-width={run.hop === 'traveler' ? 0.25 : run.dashed ? 0.35 : run.hop === 'circuit' ? 0.35 : 0.28}
												stroke-linecap="round"
												stroke-dasharray={run.hop === 'traveler' ? '0.7 0.4' : run.dashed ? '1.1 0.7' : 'none'}
											/>
										{/if}
									{/each}
								</svg>
								{#if wireRunData.ghostPanel}
									<!-- Ghost panel badge for off-floor panel -->
									<div
										class="absolute z-[3] flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/80 border border-amber-400/60 shadow-lg pointer-events-none"
										style="left: 3%; top: 3%"
									>
										<Icon icon="lucide:plug-zap" width={13} class="text-white" />
										<span class="text-[10px] text-white font-semibold whitespace-nowrap">{wireRunData.ghostPanel.name}</span>
										<span class="text-[9px] text-amber-100/80">({wireRunData.ghostPanel.floor})</span>
										{#if wireRunCircuitLabels.length > 0}
											<span class="text-[9px] text-white/90 border-l border-white/30 pl-1.5">{wireRunCircuitLabels.join(', ')}</span>
										{/if}
									</div>
								{/if}
								<!-- Circuit label near on-floor panel marker -->
								{#if !wireRunData.ghostPanel && wireRunCircuitLabels.length > 0}
									{@const panelMarkerId = [...wireRunData.relevantMarkerIds].find(id => id.startsWith('panel-'))}
									{#if panelMarkerId}
										{@const panelId = Number(panelMarkerId.split('-')[1])}
										{@const panel = allPanels.find(p => p.id === panelId)}
										{#if panel && panel.fields.Floorplan_X != null}
											{@const panelCluster = getMarkerClusters().find(c => c.items.some(i => i.type === 'panel' && i.record?.id === panelId))}
											{@const panelFanIdx = panelCluster ? panelCluster.items.findIndex(i => i.type === 'panel' && i.record?.id === panelId) : -1}
											{@const panelFanPos = panelCluster && expandedCluster === panelCluster.key && panelFanIdx >= 0 ? getFanPositions(panelCluster.items.length, panelCluster.items.some(i => i.type === 'panel') ? 5 : 3.5)[panelFanIdx] : null}
											{@const labelX = panelFanPos ? panelCluster!.x + panelFanPos.dx / 100 : (panel.fields.Floorplan_X as number)}
											{@const labelY = panelFanPos ? panelCluster!.y + panelFanPos.dy / 100 : (panel.fields.Floorplan_Y as number)}
											<div
												class="absolute z-[8] flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900/90 border border-amber-500/40 shadow-lg pointer-events-none"
												style="left: {labelX * 100}%; top: calc({labelY * 100}% + 14px); max-width: 180px; transform: translate(-50%, 0) scale({markerCounterScale}); transform-origin: top center;"
											>
												<Icon icon="mdi:lightning-bolt" width={10} class="text-amber-400 shrink-0" />
												<span class="text-[9px] text-amber-200 font-medium truncate">{wireRunCircuitLabels.join(', ')}</span>
											</div>
										{/if}
									{/if}
								{/if}
							{/if}
							{#if networkRunData && (networkRunData.lines.length > 0 || networkRunData.ghostBadges.length > 0)}
								<div class="absolute inset-0 bg-cyan-950/10 pointer-events-none transition-opacity duration-200 z-[1]"></div>
								<svg class="absolute inset-0 w-full h-full pointer-events-none z-[2]" viewBox="0 0 100 100" preserveAspectRatio="none" style="overflow: visible">
									{#each networkRunData.lines as run}
										{@const mx = (run.x1 + run.x2) / 2}
										{@const my = (run.y1 + run.y2) / 2}
										{@const dx = run.x2 - run.x1}
										{@const dy = run.y2 - run.y1}
										{@const len = Math.sqrt(dx * dx + dy * dy) || 0.001}
										{@const nx = -dy / len}
										{@const ny = dx / len}
										{@const curveAmount = Math.min(len * 0.3, 0.04)}
										{@const cx = (mx + nx * curveAmount) * 100}
										{@const cy = (my + ny * curveAmount) * 100}
										<path
											d="M {run.x1 * 100} {run.y1 * 100} Q {cx} {cy} {run.x2 * 100} {run.y2 * 100}"
											fill="none"
											stroke={run.dashed ? 'rgba(34, 211, 238, 0.78)' : 'rgba(34, 211, 238, 0.92)'}
											stroke-width={0.25}
											stroke-linecap="round"
											stroke-dasharray={run.dashed ? '1 0.6' : 'none'}
										/>
									{/each}
								</svg>
								{#each networkRunData.ghostBadges as ghost}
									<div
										class="absolute z-[8] flex items-center gap-1 px-2 py-1 rounded-lg bg-cyan-500/85 border border-cyan-300/40 shadow-lg pointer-events-none -translate-x-1/2 -translate-y-full"
										style="left: {ghost.x * 100}%; top: {ghost.y * 100}%"
									>
										<Icon icon="mdi:lan-disconnect" width={11} class="text-white" />
										<span class="text-[9px] text-white font-semibold whitespace-nowrap">{ghost.name}</span>
										<span class="text-[8px] text-cyan-50/80">({ghost.floor})</span>
									</div>
								{/each}
							{/if}
							<!-- Clustered markers -->
							{#each getMarkerClusters() as cluster}
								{@const isExpanded = expandedCluster === cluster.key}
								{@const isMergeTarget = mergeTargetKey === cluster.key}
								{@const isWireRelevant = wireRunData ? (cluster.items.some(i => i.type === 'panel') || cluster.items.some(i => {
									if (i.type === 'panel') return true;
									if (i.type === 'load') return wireRunData.relevantMarkerIds.has(`load-${i.record!.id}`);
									if (i.type === 'receptacle-group') return wireRunData.relevantMarkerIds.has(`rec-${i.group!.key}`);
									return false;
								})) : true}
								{@const isDimmed = (expandedCluster != null && !isExpanded && !isMergeTarget && !wireRunActive) || (wireRunData != null && wireRunData.lines.length > 0 && !isWireRelevant)}
								{@const isSingle = cluster.items.length === 1}
								{@const hasPanel = cluster.items.some(i => i.type === 'panel')}
								{@const fanPositions = getFanPositions(cluster.items.length, hasPanel ? 5 : 3.5)}

								{#if isSingle}
									<!-- Single marker — render directly -->
									{@const item = cluster.items[0]}
									{@const markerId = item.type === 'receptacle-group' ? item.group!.key : item.record!.id}
									{@const pos = getDraggedPos(item.type as any, markerId, item.x, item.y)}
									<button
										onpointerdown={(e) => {
											if (editingMarkers && !placingItem) startDragMarker(e, item.type as any, markerId, item.x, item.y);
										}}
										onclick={(e) => {
											e.stopPropagation();
											if (dragMoved) { dragMoved = false; return; }
											if (placingItem) { placeItemAtCoords({ Floorplan_X: item.x, Floorplan_Y: item.y, Floorplan_Id: selectedFloorId }); return; }
											if (item.type === 'room') { selectedLoadId = null; expandedGroup = null; expandedCluster = null; selectedPanelMarkerId = null; activePanel = activePanel.areaId === item.record!.id ? { areaId: 0, mode: null } : { areaId: item.record!.id, mode: 'devices' }; }
											else if (item.type === 'load') { if (!editingMarkers) { expandedGroup = null; expandedCluster = null; selectedPanelMarkerId = null; const loadCount = (item.record!.fields.Fixture_Count as number) || 1; if (loadCount > 1) { expandedFixtureLoadId = expandedFixtureLoadId === item.record!.id ? null : item.record!.id; } selectedLoadId = selectedLoadId === item.record!.id ? null : item.record!.id; } }
											else if (item.type === 'receptacle-group') { selectedLoadId = null; expandedCluster = null; selectedPanelMarkerId = null; popoverMinimized = false; expandedGroup = expandedGroup === item.group!.key ? null : item.group!.key; }
											else if (item.type === 'panel') { selectedLoadId = null; expandedGroup = null; expandedCluster = null; popoverMinimized = false; selectedPanelMarkerId = selectedPanelMarkerId === item.record!.id ? null : item.record!.id; }
										}}
										class="absolute flex flex-col items-center gap-0.5 group transition-[opacity,transform,filter] duration-200 {editingMarkers && !placingItem ? 'cursor-grab active:cursor-grabbing' : ''}"
											style="left: {pos.x * 100}%; top: {pos.y * 100}%; transform: translate(-50%, -50%) scale({markerCounterScale}); {isDimmed ? `opacity: 0.2; filter: blur(1.5px); pointer-events: none;` : `z-index: ${item.type === 'receptacle-group' && item.group && item.group.members.length > 1 ? 4 : item.type === 'room' ? 3 : 2};`} {isMergeTarget ? 'filter: drop-shadow(0 0 8px rgba(99,102,241,0.6));' : ''}"
										use:tooltip={isMergeTarget ? `Group with ${item.label}` : item.label}
									>
										{#if isMergeTarget}
											<!-- Pulsing merge ring -->
											<span class="absolute inset-0 -m-2 rounded-full border-2 border-indigo-400/70 animate-pulse pointer-events-none"></span>
											<span class="absolute -top-3 left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-indigo-500 border border-indigo-300/80 flex items-center justify-center shadow-lg z-10 pointer-events-none leading-none">
												<Icon icon="mdi:plus" width={9} class="text-white" />
											</span>
										{/if}
										{#if item.type === 'room'}
											<span class="w-6 h-6 rounded-full {item.marker.bg} border-2 border-white/60 shadow-[0_0_0_1.5px_rgba(0,0,0,0.5),0_2px_4px_rgba(0,0,0,0.3)] flex items-center justify-center transition-all duration-150 group-hover:scale-110 origin-center relative">
												<Icon icon={item.marker.icon} width={12} class="text-white block" />
												{#if cluster.hiddenCount > 0}
													<span class="absolute -bottom-1.5 -left-1.5 w-3 h-3 rounded-full bg-slate-600/80 border border-dashed border-slate-400/60 text-white flex items-center justify-center text-[7px]" title="{cluster.hiddenCount} hidden (layer off)">+{cluster.hiddenCount}</span>
												{/if}
											</span>
											<span class="absolute top-full mt-0.5 left-1/2 -translate-x-1/2 text-[9px] font-medium text-white bg-slate-900/80 px-1.5 py-0.5 rounded whitespace-nowrap backdrop-blur-sm">{item.label}</span>
										{:else if item.type === 'receptacle-group' && item.group && item.group.members.length > 1}
												<!-- Gang box: show mini faceplate when wire-runs target this gang -->
												{@const gangIsWireTarget = wireRunData && wireRunData.relevantMarkerIds.has(`rec-${item.group.key}`) && wireRunData.lines.length > 0}
												{#if gangIsWireTarget}
													<!-- Mini faceplate: inline member icons with highlights -->
													<span class="flex items-center rounded-md bg-slate-800/90 border border-slate-500/80 px-1 py-0.5 gap-1 shadow-lg">
														{#each item.group.members as member}
															{@const mm = getDeviceMarker(member, 'receptacle')}
															{@const memberRelevant = wireRunData!.relevantRecIds.has(member.id)}
															<span class="w-4.5 h-4.5 rounded {mm.bg} flex items-center justify-center transition-all duration-150 border border-white/20 {memberRelevant ? 'ring-2 ring-white/90 scale-110' : 'opacity-30'}" style="width: 18px; height: 18px;">
																<Icon icon={mm.icon} width={9} class="text-white block" />
															</span>
														{/each}
													</span>
												{:else}
													<span class="w-5 h-5 rounded-full {item.marker.bg} border border-white/50 shadow-[0_0_0_1.5px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.3)] flex items-center justify-center transition-all duration-150 group-hover:scale-110 origin-center relative">
														<Icon icon={item.marker.icon} width={10} class="text-white block" />
														<span class="absolute -top-2 -right-2 w-3.5 h-3.5 rounded-full bg-slate-500 text-white flex items-center justify-center text-[8px] font-bold shadow z-10">{item.group.members.length}</span>
														{#if getMultiWayCount(item.group) >= 2}
															<span class="absolute -bottom-1.5 -right-1.5 px-0.5 rounded bg-cyan-600 text-white text-[6px] font-bold shadow z-10 leading-tight">{getMultiWayCount(item.group)}W</span>
														{/if}
														{#if cluster.hiddenCount > 0}
															<span class="absolute -bottom-1.5 -left-1.5 w-3 h-3 rounded-full bg-slate-600/80 border border-dashed border-slate-400/60 text-white flex items-center justify-center text-[7px]" title="{cluster.hiddenCount} hidden (layer off)">+{cluster.hiddenCount}</span>
														{/if}
													</span>
												{/if}
										{:else if item.type === 'panel'}
												<!-- Panel: distinct square marker -->
												<span class="w-7 h-7 rounded-sm {item.marker.bg} border-2 border-white/70 shadow-[0_0_0_1.5px_rgba(0,0,0,0.5),0_2px_4px_rgba(0,0,0,0.3)] flex items-center justify-center transition-all duration-150 group-hover:scale-110 origin-center relative {selectedPanelMarkerId === item.record?.id ? 'ring-2 ring-white/80 scale-110' : ''}">
													<Icon icon={item.marker.icon} width={14} class="text-white block" />
												</span>
										{:else}
											<span class="w-5 h-5 rounded-full {item.marker.bg} border border-white/50 shadow-[0_0_0_1.5px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.3)] flex items-center justify-center transition-all duration-150 group-hover:scale-110 origin-center {item.type === 'load' && selectedLoadId === item.record?.id ? 'ring-2 ring-white/80 scale-110' : ''} relative">
												<Icon icon={item.marker.icon} width={10} class="text-white block" />
												{#if item.type === 'load' && item.record && viewLayer === 'network' && isPoeLoad(item.record)}
													<span class="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-cyan-500 text-white flex items-center justify-center text-[6px] shadow z-10">
														<Icon icon="mdi:lightning-bolt" width={7} />
													</span>
												{/if}
												{#if item.type === 'load' && item.record && ((item.record.fields.Fixture_Count as number) || 1) > 1 && !isLoadFixtureExpanded(item.record)}
													<span class="absolute {viewLayer === 'network' && isPoeLoad(item.record) ? '-top-2 -left-2' : '-top-2 -right-2'} w-3.5 h-3.5 rounded-full bg-amber-600 text-white flex items-center justify-center text-[7px] font-bold shadow z-10">{item.record.fields.Fixture_Count}</span>
												{/if}
												{#if item.type === 'receptacle-group' && item.group && getMultiWayCount(item.group) >= 2}
													<span class="absolute -bottom-1.5 -right-1.5 px-0.5 rounded bg-cyan-600 text-white text-[6px] font-bold shadow z-10 leading-tight">{getMultiWayCount(item.group)}W</span>
												{/if}
												{#if cluster.hiddenCount > 0}
													<span class="absolute -bottom-1.5 -left-1.5 w-3 h-3 rounded-full bg-slate-600/80 border border-dashed border-slate-400/60 text-white flex items-center justify-center text-[7px]" title="{cluster.hiddenCount} hidden (layer off)">+{cluster.hiddenCount}</span>
												{/if}
											</span>
										{/if}
									</button>
									<!-- Fixture markers: show individual fixtures at their actual positions -->
									{#if item.type === 'load' && item.record && isLoadFixtureExpanded(item.record)}
										{@const fixturePositions = getFixturePositions(item.record)}
										{@const fixtureMarker = getDeviceMarker(item.record, 'load')}
										{#if fixturePositions.length > 0}
											{#each fixturePositions as fpos, fi}
												{@const fDragPos = draggingFixture && draggingFixture.loadId === item.record.id && draggingFixture.fixtureIndex === fi && dragFixturePos ? dragFixturePos : fpos}
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<span
													data-fixture
													onpointerdown={(e) => { if (editingMarkers) startDragFixture(e, item.record!.id, fi, fpos.x, fpos.y); }}
													onclick={(e) => { e.stopPropagation(); if (!editingMarkers || !dragMoved) { selectedLoadId = selectedLoadId === item.record!.id ? null : item.record!.id; } }}
													use:tooltip={`${item.label} (fixture ${fi + 1})`}
													class="absolute w-5 h-5 rounded-full {fixtureMarker.bg} border border-white/50 shadow-[0_0_0_1.5px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.3)] flex items-center justify-center transition-all duration-200 {editingMarkers ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}"
													style="left: {fDragPos.x * 100}%; top: {fDragPos.y * 100}%; transform: translate(-50%, -50%) scale({markerCounterScale}); z-index: 6; {isDimmed ? 'opacity: 0.2; filter: blur(1.5px); pointer-events: none;' : ''}"
												>
													<Icon icon={fixtureMarker.icon} width={10} class="text-white block" />
												</span>
											{/each}
											<!-- Connecting lines from load center to each fixture (only when active/selected or dragging) -->
											{#if selectedLoadId === item.record.id || (draggingFixture && draggingFixture.loadId === item.record.id)}
											<svg class="absolute inset-0 w-full h-full pointer-events-none" style="z-index: 5;">
												{#each fixturePositions as fpos, fi}
													{@const fDragPos = draggingFixture && draggingFixture.loadId === item.record.id && draggingFixture.fixtureIndex === fi && dragFixturePos ? dragFixturePos : fpos}
													<line
														x1="{pos.x * 100}%" y1="{pos.y * 100}%"
														x2="{fDragPos.x * 100}%" y2="{fDragPos.y * 100}%"
														stroke="rgba(251, 191, 36, 0.4)" stroke-width="1" stroke-dasharray="3 2"
													/>
												{/each}
											</svg>
											{/if}
										{/if}
									{/if}
								{:else}
									<!-- Multi-marker cluster: always render items for animation -->
									{#each cluster.items as item, idx}
										{@const fan = fanPositions[idx]}
										{@const targetX = isExpanded ? (cluster.x + fan.dx / 100) : cluster.x}
										{@const targetY = isExpanded ? (cluster.y + fan.dy / 100) : cluster.y}
										{@const isItemWireRelevant = wireRunData && wireRunData.lines.length > 0 ? (
											item.type === 'panel' ? true :
											item.type === 'load' ? wireRunData.relevantMarkerIds.has(`load-${item.record!.id}`) :
											item.type === 'receptacle-group' ? wireRunData.relevantMarkerIds.has(`rec-${item.group!.key}`) :
											false
										) : true}
										{@const isItemDimmed = isDimmed || (isExpanded && wireRunData != null && wireRunData.lines.length > 0 && !isItemWireRelevant)}
										<button
											onclick={(e) => {
												e.stopPropagation();
												if (!isExpanded) {
													if (placingItem) { placeItemAtCoords({ Floorplan_X: cluster.x, Floorplan_Y: cluster.y, Floorplan_Id: selectedFloorId }); return; }
													selectedLoadId = null; expandedGroup = null; expandedCluster = cluster.key;
													return;
												}
												if (item.type === 'room') { selectedLoadId = null; expandedGroup = null; activePanel = activePanel.areaId === item.record!.id ? { areaId: 0, mode: null } : { areaId: item.record!.id, mode: 'devices' }; }
												else if (item.type === 'load') { expandedGroup = null; selectedLoadId = selectedLoadId === item.record!.id ? null : item.record!.id; }
												else if (item.type === 'receptacle-group') { selectedLoadId = null; popoverMinimized = false; expandedGroup = expandedGroup === item.group!.key ? null : item.group!.key; }
													else if (item.type === 'panel') { selectedLoadId = null; expandedGroup = null; selectedPanelMarkerId = selectedPanelMarkerId === item.record!.id ? null : item.record!.id; }
											}}
											class="absolute flex flex-col items-center gap-0.5 group transition-[opacity,transform,filter] duration-200"
											style="left: {targetX * 100}%; top: {targetY * 100}%; transform: translate(-50%, -50%) scale({markerCounterScale}); transition: {expandedCluster ? 'left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), ' : ''}opacity 0.2s, transform 0.2s, filter 0.2s; z-index: {isExpanded ? 5 : isMergeTarget ? 10 : isItemDimmed ? 0 : 3 - idx}; opacity: {isItemDimmed ? 0.2 : isExpanded ? 1 : (idx === 0 ? 1 : 0.6)}; {isItemDimmed ? 'filter: blur(1.5px);' : ''} {(isItemDimmed || (!isExpanded && idx > 0)) ? 'pointer-events: none;' : ''} {isMergeTarget && !isExpanded && idx === 0 ? 'filter: drop-shadow(0 0 8px rgba(99,102,241,0.6));' : ''}"
											use:tooltip={isMergeTarget && !isExpanded ? `Group here (${cluster.items.length} items)` : isExpanded ? item.label : `${cluster.items.length} items`}
										>
											{#if !isExpanded && idx === 0}
													<!-- Collapsed cluster marker — varies by clusterStyle setting -->
													{@const roomItem = cluster.items.find(i => i.type === 'room')}
																{@const panelItem = cluster.items.find(i => i.type === 'panel')}

																{#if panelItem}
																	<!-- Panel-anchored cluster: panel icon stays prominent with gradient border showing grouped types -->
																	{@const grad = getGradientStops(cluster)}
																	{@const otherCount = cluster.items.length - 1 + cluster.hiddenCount}
																	<span
																		class="w-8 h-8 rounded-sm shadow-lg flex items-center justify-center relative transition-transform duration-150 group-hover:scale-110 origin-center"
																		style="background: conic-gradient(from {grad.rotation}deg, {grad.stops}); padding: 3px;"
																	>
																		<span class="w-full h-full rounded-[2px] bg-amber-500/90 flex items-center justify-center">
																			<Icon icon="lucide:plug-zap" width={14} class="text-white block" />
																		</span>
																		{#if otherCount > 0}
																			<span class="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-slate-500 text-white flex items-center justify-center text-[8px] font-bold shadow z-10">+{otherCount}</span>
																		{/if}
																		{#if cluster.hiddenCount > 0}
																			<span class="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 rounded-full bg-slate-600/80 border border-dashed border-slate-400/60 text-white flex items-center justify-center text-[7px]" title="{cluster.hiddenCount} hidden (layer off)">+{cluster.hiddenCount}</span>
																		{/if}
																	</span>
																{:else if clusterStyle === 'dots'}
																	<!-- Style A: Custom colored dots hexagon -->
																	{@const dotPositions = [[8, 8], [8, 3.5], [11.9, 5.75], [11.9, 10.25], [8, 12.5], [4.1, 10.25], [4.1, 5.75]]}
																	{@const dotColors = getDotColors(cluster)}
																	<span class="w-7 h-7 rounded-full bg-slate-900/95 border-2 border-white/50 shadow-lg flex items-center justify-center relative transition-transform duration-150 group-hover:scale-110 origin-center">
																		<svg width="16" height="16" viewBox="0 0 16 16" class="block">
																			{#each dotPositions as [cx, cy], dIdx}
																				<circle cx={cx} cy={cy} r="1.8" fill={dotColors[dIdx]} />
																			{/each}
																		</svg>
																		<span class="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-slate-500 text-white flex items-center justify-center text-[8px] font-bold shadow z-10">{cluster.items.length + cluster.hiddenCount}</span>
																		{#if cluster.hiddenCount > 0}
																			<span class="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 rounded-full bg-slate-600/80 border border-dashed border-slate-400/60 text-white flex items-center justify-center text-[7px]" title="{cluster.hiddenCount} hidden (layer off)">+{cluster.hiddenCount}</span>
																		{/if}
																	</span>

																{:else if clusterStyle === 'gradient'}
																	<!-- Style B: Gradient border ring — segments match fan-out angles -->
																	{@const grad = getGradientStops(cluster)}
																	<span
																		class="w-7 h-7 rounded-full shadow-lg flex items-center justify-center relative transition-transform duration-150 group-hover:scale-110 origin-center"
																		style="background: conic-gradient(from {grad.rotation}deg, {grad.stops}); padding: 3.5px;"
																	>
																		<span class="w-full h-full rounded-full bg-slate-900/95 flex items-center justify-center">
																			<Icon icon="mdi:dots-hexagon" width={11} class="text-white/90 block" />
																		</span>
																		<span class="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-slate-500 text-white flex items-center justify-center text-[8px] font-bold shadow z-10">{cluster.items.length + cluster.hiddenCount}</span>
																		{#if cluster.hiddenCount > 0}
																			<span class="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 rounded-full bg-slate-600/80 border border-dashed border-slate-400/60 text-white flex items-center justify-center text-[7px]" title="{cluster.hiddenCount} hidden (layer off)">+{cluster.hiddenCount}</span>
																		{/if}
																	</span>
																{/if}

																{#if panelItem}
																	<span class="absolute top-full mt-0.5 left-1/2 -translate-x-1/2 text-[9px] font-medium text-white bg-amber-900/80 px-1.5 py-0.5 rounded whitespace-nowrap backdrop-blur-sm">{panelItem.label}</span>
																{:else if roomItem}
																	<span class="absolute top-full mt-0.5 left-1/2 -translate-x-1/2 text-[9px] font-medium text-white bg-slate-900/80 px-1.5 py-0.5 rounded whitespace-nowrap backdrop-blur-sm">{roomItem.label}</span>
																{/if}
											{:else if isExpanded}
												{#if item.type === 'room'}
													<span class="w-6 h-6 rounded-full {item.marker.bg} border-2 border-white/60 shadow-[0_0_0_1.5px_rgba(0,0,0,0.5),0_2px_4px_rgba(0,0,0,0.3)] flex items-center justify-center transition-all duration-150 group-hover:scale-110 origin-center">
														<Icon icon={item.marker.icon} width={12} class="text-white block" />
													</span>
													<span class="absolute top-full mt-0.5 left-1/2 -translate-x-1/2 text-[9px] font-medium text-white bg-slate-900/80 px-1.5 py-0.5 rounded whitespace-nowrap backdrop-blur-sm">{item.label}</span>
												{:else if item.type === 'receptacle-group' && item.group && item.group.members.length > 1}
													<!-- Gang box in expanded cluster: show mini faceplate when wire-runs target it -->
													{@const gangIsWireTarget2 = wireRunData && wireRunData.relevantMarkerIds.has(`rec-${item.group.key}`) && wireRunData.lines.length > 0}
													{#if gangIsWireTarget2}
														<span class="flex items-center rounded-md bg-slate-800/90 border border-slate-500/80 px-1 py-0.5 gap-1 shadow-lg">
															{#each item.group.members as member}
																{@const mm = getDeviceMarker(member, 'receptacle')}
																{@const memberRelevant2 = wireRunData!.relevantRecIds.has(member.id)}
																<span class="rounded {mm.bg} flex items-center justify-center transition-all duration-150 border border-white/20 {memberRelevant2 ? 'ring-2 ring-white/90 scale-110' : 'opacity-30'}" style="width: 18px; height: 18px;">
																	<Icon icon={mm.icon} width={9} class="text-white block" />
																</span>
															{/each}
														</span>
													{:else}
														<span class="w-5 h-5 rounded-full {item.marker.bg} border border-white/50 shadow-[0_0_0_1.5px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.3)] flex items-center justify-center transition-all duration-150 group-hover:scale-110 origin-center relative">
															<Icon icon={item.marker.icon} width={10} class="text-white block" />
															<span class="absolute -top-2 -right-2 w-3.5 h-3.5 rounded-full bg-slate-500 text-white flex items-center justify-center text-[8px] font-bold shadow z-10">{item.group.members.length}</span>
														</span>
													{/if}
												{:else if item.type === 'panel'}
													<span class="w-7 h-7 rounded-sm {item.marker.bg} border-2 border-white/70 shadow-[0_0_0_1.5px_rgba(0,0,0,0.5),0_2px_4px_rgba(0,0,0,0.3)] flex items-center justify-center transition-all duration-150 group-hover:scale-110 origin-center">
														<Icon icon={item.marker.icon} width={14} class="text-white block" />
													</span>
												{:else}
													<span class="w-5 h-5 rounded-full {item.marker.bg} border border-white/50 shadow-[0_0_0_1.5px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.3)] flex items-center justify-center transition-all duration-150 group-hover:scale-110 origin-center {item.type === 'load' && selectedLoadId === item.record?.id ? 'ring-2 ring-white/80 scale-110' : ''} relative">
														<Icon icon={item.marker.icon} width={10} class="text-white block" />
														{#if item.type === 'load' && item.record && viewLayer === 'network' && isPoeLoad(item.record)}
															<span class="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-cyan-500 text-white flex items-center justify-center text-[6px] shadow z-10">
																<Icon icon="mdi:lightning-bolt" width={7} />
															</span>
														{/if}
													</span>
												{/if}
											{/if}
										</button>
									{/each}
									<!-- Collapse button (only when expanded, small so it doesn't overlap) -->
									{#if isExpanded}
										<button
											onclick={(e) => { e.stopPropagation(); expandedCluster = null; }}
											class="absolute w-3.5 h-3.5 rounded-full bg-slate-600/80 border border-slate-400/60 flex items-center justify-center -translate-x-1/2 -translate-y-1/2 hover:bg-slate-500 transition-colors z-[6]"
											style="left: {cluster.x * 100}%; top: {cluster.y * 100}%"
											title="Collapse"
										>
											<Icon icon="mdi:close" width={8} class="text-slate-400" />
										</button>
									{/if}
								{/if}
							{/each}
							</div>
							{/key}
							</div>
						</div>
						{#if editingMarkers && placingItem}
							<div class="absolute inset-0 bg-amber-500/5 pointer-events-none flex items-center justify-center">
								<span class="text-xs text-amber-300 bg-slate-900/90 px-3 py-1.5 rounded-lg backdrop-blur-sm">Tap to place</span>
							</div>
						{/if}
						{#if placingFixture}
							<div class="absolute inset-0 bg-amber-500/5 pointer-events-none flex items-center justify-center">
								<span class="text-xs text-amber-300 bg-slate-900/90 px-3 py-1.5 rounded-lg backdrop-blur-sm flex items-center gap-2">
									<Icon icon="mdi:lightbulb-multiple-outline" width={14} />
									Tap to place fixture {placingFixture.fixtureIndex + 1} of {placingFixture.total}
									<button class="text-slate-400 hover:text-white ml-2 pointer-events-auto" onclick={(e) => { e.stopPropagation(); placingFixture = null; }}>✕</button>
								</span>
							</div>
						{/if}
						<!-- Persistent zoom controls support mouse, touch, and keyboard users. -->
						<div class="absolute top-3 right-3 z-30 flex overflow-hidden rounded-lg border border-slate-600/60 bg-slate-900/90">
							<button
								onclick={(e) => { e.stopPropagation(); setFloorplanZoom(floorplanScale - 0.25); }}
								disabled={floorplanScale <= 1}
								class="flex h-10 w-10 items-center justify-center text-slate-200 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:text-slate-600"
								title="Zoom out"
								aria-label="Zoom out"
							>
								<Icon icon="mdi:minus" width={18} />
							</button>
							<button
								onclick={(e) => { e.stopPropagation(); resetZoom(); }}
								disabled={floorplanScale === 1}
								class="h-10 min-w-14 border-x border-slate-700/70 px-2 text-xs font-medium tabular-nums text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 disabled:cursor-default disabled:text-slate-500"
								title="Reset zoom"
								aria-label="Reset zoom to 100%"
							>
								{Math.round(floorplanScale * 100)}%
							</button>
							<button
								onclick={(e) => { e.stopPropagation(); setFloorplanZoom(floorplanScale + 0.25); }}
								disabled={floorplanScale >= 5}
								class="flex h-10 w-10 items-center justify-center text-slate-200 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:text-slate-600"
								title="Zoom in"
								aria-label="Zoom in"
							>
								<Icon icon="mdi:plus" width={18} />
							</button>
						</div>
						</div>
						<!-- Popover overlay (outside overflow-hidden so popovers aren't clipped) -->
						<div class="absolute inset-0 pointer-events-none overflow-visible z-10">
							<div class="relative w-full h-full pointer-events-none">
								<!-- Load detail popover (outside transform for zoom compatibility) -->
							{#if selectedLoadId}
								{@const popLoad = allLoads.find(l => l.id === selectedLoadId)}
								{#if popLoad && popLoad.fields.Floorplan_X != null}
									{@const marker = getDeviceMarker(popLoad, 'load')}
									{@const loadPopFlip = (popLoad.fields.Floorplan_Y as number) > 0.6}
									{@const loadPopX = popLoad.fields.Floorplan_X as number}
									{@const loadXAlign = loadPopX < 0.2 ? 'left' : loadPopX > 0.8 ? 'right' : 'center'}
									{@const networkUpstream = getNetworkUpstreamRecord(popLoad)}
									{@const downstreamLoads = getDownstreamLoads(popLoad.id)}
									<div
										class="absolute z-20 pointer-events-auto {loadPopFlip ? '-translate-y-full' : ''} {loadXAlign === 'center' ? '-translate-x-1/2' : loadXAlign === 'right' ? '-translate-x-full' : ''}"
										style="left: {loadPopX * 100}%; {loadPopFlip ? `top: calc(${(popLoad.fields.Floorplan_Y as number) * 100}% - 16px)` : `top: calc(${(popLoad.fields.Floorplan_Y as number) * 100}% + 16px)`}"
									>
										<div class="bg-slate-900/95 border border-slate-600/60 rounded-lg shadow-xl backdrop-blur-sm p-2.5 min-w-[160px] space-y-1" onclick={(e) => e.stopPropagation()}>
											<div class="flex items-center gap-1.5">
												<span class="w-4 h-4 rounded-full {marker.bg} flex items-center justify-center shrink-0">
													<Icon icon={marker.icon} width={9} class="text-white" />
												</span>
												<span class="text-[11px] font-medium text-white truncate">{getDisplayName(popLoad, 'Load')}</span>
											</div>
											{#if popLoad.fields['Device Type']}
												<p class="text-[10px] text-slate-400">Type: {popLoad.fields['Device Type']}</p>
											{/if}
											{#if ((popLoad.fields.Fixture_Count as number) || 1) > 1}
												{@const fPositions = getFixturePositions(popLoad)}
												<div class="flex items-center gap-1 text-[10px] text-amber-400/80">
													<Icon icon="mdi:lightbulb-group" width={11} />
													<span>{popLoad.fields.Fixture_Count} fixtures</span>
													{#if popLoad.fields.Display_Mode === 'expanded'}
														<span class="text-[8px] text-amber-300/60 ml-1">(always shown)</span>
													{/if}
													{#if fPositions.length === 0}
														<span class="text-[8px] text-slate-500 ml-1">(not yet placed)</span>
													{/if}
												</div>
											{/if}
											{#if popLoad.fields['Area']}
												<p class="text-[10px] text-slate-400">Room: {(popLoad.fields['Area'] as any)?.fields?.Name || (popLoad.fields['Area'] as any)?.Name || ''}</p>
											{/if}
											{#if popLoad.fields['Receptacle Name']}
												<p class="text-[10px] text-slate-400">Switch: {popLoad.fields['Receptacle Name']}</p>
											{/if}
											{#if viewLayer === 'network'}
												<div class="border-t border-cyan-500/20 pt-1 space-y-1">
													{#if popLoad.fields.Network_Role}
														<p class="text-[10px] text-slate-300">Role: <span class="text-cyan-300">{popLoad.fields.Network_Role}</span></p>
													{/if}
													<p class="text-[10px] text-slate-300">Power: <span class="{isPoeLoad(popLoad) ? 'text-cyan-300' : 'text-amber-300'}">{getPowerSource(popLoad)}</span></p>
													<p class="text-[10px] text-slate-300">
														Upstream:
														{#if networkUpstream}
															<span class="text-cyan-300">{getDisplayName(networkUpstream, 'Load')}</span>
															<button
																onclick={(e) => { e.stopPropagation(); traceNetworkUpstream(popLoad); }}
																class="ml-1 text-[9px] text-cyan-400 hover:text-cyan-200"
															>
																Trace upstream
															</button>
														{:else}
															<span class="text-slate-500">Unlinked</span>
														{/if}
													</p>
													{#if popLoad.fields.Network_Match_Key}
														<p class="text-[10px] text-slate-300 break-all">Match key: <span class="text-slate-400">{popLoad.fields.Network_Match_Key}</span></p>
													{/if}
													<p class="text-[10px] text-slate-300">Downstream devices: <span class="text-cyan-300">{downstreamLoads.length}</span></p>
												</div>
											{/if}
											{#if true}
											{@const loadRecName = popLoad.fields.Name as string}
											{@const allSwitchesForLoad = loadRecName ? allReceptacles.filter(r => { const lnf = r.fields['Load Name(s)']; const names: string[] = typeof lnf === 'string' ? lnf.split(',').map((s: string) => s.trim()) : Array.isArray(lnf) ? lnf : []; return names.includes(loadRecName); }) : []}
											{@const loadCircuits = getCircuitsForLoad(popLoad)}
											<div class="border-t border-slate-700/50 pt-1.5 space-y-1">
												<p class="text-[9px] uppercase tracking-wide text-slate-500">Circuit</p>
												{#if loadCircuits.length > 0}
													{#each loadCircuits as circuit}
														{@const panel = getCircuitPanel(circuit)}
														<a
															href={getCircuitPanelHref(circuit)}
															onclick={(e) => e.stopPropagation()}
															class="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 hover:bg-amber-500/10 hover:border-amber-500/40 transition-colors"
														>
															<Icon icon="mdi:electric-switch" width={13} class="text-amber-400 shrink-0" />
															<span class="min-w-0 flex-1">
																<span class="block text-[10px] font-medium text-slate-200 truncate">{panel?.fields.Name || 'Panel'} · Circuit {getCircuitNumber(circuit)}</span>
																<span class="block text-[9px] text-slate-500 truncate">{circuit.fields.Name || 'Unnamed'}{circuit.fields.Amps ? ` · ${circuit.fields.Amps}A` : ''}</span>
															</span>
															<Icon icon="mdi:arrow-right" width={12} class="text-amber-400/70 shrink-0" />
														</a>
													{/each}
												{:else}
													<p class="text-[10px] text-slate-500">Not assigned</p>
												{/if}
											</div>
											{#if allSwitchesForLoad.length > 1}
												<div class="text-[9px] text-cyan-400/80 flex items-center gap-1 pt-0.5">
													<Icon icon="mdi:swap-horizontal" width={10} />
													<span>{allSwitchesForLoad.length}-way switch ({allSwitchesForLoad.map(r => getDisplayName(r, 'Receptacle')).join(' · ')})</span>
												</div>
											{/if}
											{@const loadCircuitId = loadCircuits[0]?.id ?? null}
											<div class="border-t border-slate-700/50 pt-1 flex items-center gap-2 flex-wrap">
												{#if viewLayer === 'power' && loadCircuitId}
													<button
														onclick={(e) => { e.stopPropagation(); const newId = tracingCircuitId === loadCircuitId ? null : loadCircuitId; tracingCircuitId = newId; if (newId) { selectedLoadId = null; } }}
														class="text-[10px] flex items-center gap-1 {tracingCircuitId === loadCircuitId ? 'text-amber-300' : 'text-amber-400/70 hover:text-amber-300'}"
													>
														<Icon icon="mdi:electric-switch" width={11} />
														{tracingCircuitId === loadCircuitId ? 'Hide circuit' : 'Trace circuit'}
													</button>
												{/if}
												{#if ((popLoad.fields.Fixture_Count as number) || 1) > 1}
													{@const placedCount = getFixturePositions(popLoad).length}
													{@const totalCount = (popLoad.fields.Fixture_Count as number) || 1}
													<button
														onclick={(e) => { e.stopPropagation(); startPlacingFixtures(popLoad.id); }}
														class="text-[10px] flex items-center gap-1 text-amber-400/70 hover:text-amber-300"
													>
														<Icon icon="mdi:lightbulb-multiple-outline" width={11} />
														{placedCount >= totalCount ? 'Reposition' : `Place fixtures (${placedCount}/${totalCount})`}
													</button>
												{/if}
												<button
													onclick={(e) => { e.stopPropagation(); removeLoadPin(popLoad); }}
													class="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 ml-auto"
												>
													<Icon icon="mdi:map-marker-remove" width={11} />
													Remove pin
												</button>
											</div>
											{/if}
										</div>
									</div>
								{/if}
							{/if}
							<!-- Receptacle group popover (outside transform for zoom compatibility) -->
							{#if expandedGroup}
								{@const popGroup = getReceptacleGroupsForFloor().find(g => g.key === expandedGroup)}
								{#if popGroup}
									{@const popDir = (popGroup.members[0].fields['Loc.Direction'] as string || '').charAt(0)}
									{@const popVertical = popDir === 'E' || popDir === 'W'}
									{@const popGroupFlip = popGroup.y > 0.6}
										{@const popGroupXAlign = popGroup.x < 0.2 ? 'left' : popGroup.x > 0.8 ? 'right' : 'center'}
										{@const popoverOffset = 40}
										{@const groupCircuits = getCircuitsForReceptacles(popGroup.members)}
										{#if !popoverMinimized}
										<div
											class="absolute z-20 pointer-events-auto {popGroupFlip ? '-translate-y-full' : ''} {popGroupXAlign === 'center' ? '-translate-x-1/2' : popGroupXAlign === 'right' ? '-translate-x-full' : ''}"
											style="left: {popGroup.x * 100}%; {popGroupFlip ? `top: calc(${popGroup.y * 100}% - ${popoverOffset}px)` : `top: calc(${popGroup.y * 100}% + ${popoverOffset}px)`}"
										>
										<div class="bg-slate-900/95 border border-slate-600/60 rounded-lg shadow-xl backdrop-blur-sm p-2.5 min-w-[160px] space-y-1.5" onclick={(e) => e.stopPropagation()}>
											<!-- Faceplate visual header -->
											<div class="flex items-center justify-center gap-1 pb-1.5 border-b border-slate-700/50">
												<div class="flex items-center rounded-md bg-slate-800 border border-slate-600/80 px-1.5 py-1 gap-1">
													{#each popGroup.members as member}
														{@const m = getDeviceMarker(member, 'receptacle')}
														<span class="w-6 h-6 rounded {m.bg} flex items-center justify-center border border-white/20">
															<Icon icon={m.icon} width={12} class="text-white block" />
														</span>
													{/each}
												</div>
												<span class="text-[9px] text-slate-400 ml-1.5">{popGroup.members.length}-gang</span>
											</div>
											<!-- Member details -->
											{#each popGroup.members as member, mIdx}
												{@const m = getDeviceMarker(member, 'receptacle')}
												{@const circuit = allCircuits.find(c => c.id === getReceptacleCircuitId(member))}
												{@const memberLoadNames = (() => { const lnf = member.fields['Load Name(s)']; return typeof lnf === 'string' ? lnf.split(',').map((s: string) => s.trim()).filter(Boolean) : Array.isArray(lnf) ? lnf.filter(Boolean) : []; })()}
												{@const siblingSwitches = memberLoadNames.length > 0 ? allReceptacles.filter(r => r.id !== member.id && (() => { const lnf = r.fields['Load Name(s)']; const names: string[] = typeof lnf === 'string' ? lnf.split(',').map((s: string) => s.trim()) : Array.isArray(lnf) ? lnf : []; return memberLoadNames.some(n => names.includes(n)); })()) : []}
												<div class="flex items-center gap-1.5 text-[10px] py-0.5 {mIdx > 0 ? 'border-t border-slate-800/60' : ''}">
													<span class="w-4 h-4 rounded-full {m.bg} flex items-center justify-center shrink-0">
														<Icon icon={m.icon} width={9} class="text-white" />
													</span>
													<div class="flex flex-col min-w-0 flex-1">
														<span class="text-slate-200 truncate">{getDisplayName(member, 'Receptacle')}</span>
														<span class="text-[9px] text-slate-500">{member.fields['Receptacle Type'] || ''}{circuit ? ` · Ckt ${circuit.fields['Circuit #'] || circuit.id}` : ''}</span>
														{#if siblingSwitches.length > 0}
															<span class="text-[8px] text-cyan-400/70 flex items-center gap-0.5">
																<Icon icon="mdi:swap-horizontal" width={8} />
																{siblingSwitches.length + 1}-way · also: {siblingSwitches.map(r => getDisplayName(r, 'Receptacle')).join(', ')}
															</span>
														{/if}
													</div>
													{#if popGroup.members.length > 1 && editingMarkers}
														<button
															onclick={(e) => { e.stopPropagation(); removeFromGang(member); }}
															class="text-slate-500 hover:text-red-400 transition-colors shrink-0"
															title="Remove from gang"
														>
															<Icon icon="mdi:close-circle-outline" width={12} />
														</button>
													{/if}
												</div>
											{/each}
											<!-- Add to gang (show same-room unplaced receptacles) -->
											{#if editingMarkers}
												{@const gangAreaId = popGroup.members[0]?.fields.Area_id || popGroup.members[0]?.fields.AreaId}
												{@const addable = allReceptacles.filter(r => !r.fields.Floorplan_Id && (r.fields.Area_id || r.fields.AreaId) == gangAreaId && !popGroup.members.some(m => m.id === r.id))}
												{#if addable.length > 0}
													<div class="pt-1 border-t border-slate-700/50">
														<p class="text-[9px] text-slate-500 mb-1">Add to gang:</p>
														<div class="flex flex-wrap gap-1">
															{#each addable.slice(0, 6) as addRec}
																{@const am = getDeviceMarker(addRec, 'receptacle')}
																<button
																	onclick={(e) => { e.stopPropagation(); addToGang(addRec, popGroup); }}
																	class="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-slate-300 transition-colors"
																	title={getDisplayName(addRec, 'Receptacle')}
																>
																	<span class="w-3 h-3 rounded-full {am.bg} flex items-center justify-center">
																		<Icon icon={am.icon} width={7} class="text-white" />
																	</span>
																	<span class="truncate max-w-[60px]">{getDisplayName(addRec, 'Receptacle')}</span>
																</button>
															{/each}
															{#if addable.length > 6}
																<span class="text-[9px] text-slate-500 self-center">+{addable.length - 6} more</span>
															{/if}
														</div>
													</div>
												{/if}
											{/if}
											<div class="pt-1 border-t border-slate-700/50 space-y-1">
												<p class="text-[9px] uppercase tracking-wide text-slate-500">Circuit</p>
												{#if groupCircuits.length > 0}
													{#each groupCircuits as circuit}
														{@const panel = getCircuitPanel(circuit)}
														<a
															href={getCircuitPanelHref(circuit)}
															onclick={(e) => e.stopPropagation()}
															class="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 hover:bg-amber-500/10 hover:border-amber-500/40 transition-colors"
														>
															<Icon icon="mdi:electric-switch" width={13} class="text-amber-400 shrink-0" />
															<span class="min-w-0 flex-1">
																<span class="block text-[10px] font-medium text-slate-200 truncate">{panel?.fields.Name || 'Panel'} · Circuit {getCircuitNumber(circuit)}</span>
																<span class="block text-[9px] text-slate-500 truncate">{circuit.fields.Name || 'Unnamed'}{circuit.fields.Amps ? ` · ${circuit.fields.Amps}A` : ''}</span>
															</span>
															<Icon icon="mdi:arrow-right" width={12} class="text-amber-400/70 shrink-0" />
														</a>
													{/each}
												{:else}
													<p class="text-[10px] text-slate-500">Not assigned</p>
												{/if}
											</div>
											<!-- Footer info -->
											<div class="text-[9px] text-slate-500 pt-1 border-t border-slate-700/50 flex items-center gap-1">
												<Icon icon="mdi:compass-outline" width={10} class="text-slate-500" />
												{popGroup.members[0].fields['Loc.Direction'] || 'Unset'} wall · {popGroup.members[0].fields['Loc.Placement'] || ''}
											</div>
											{#if true}
											{@const recCircuitIds = groupCircuits.map((circuit) => circuit.id)}
											<div class="flex items-center gap-2 pt-0.5">
												{#if recCircuitIds.length > 0}
													<button
														onclick={(e) => { e.stopPropagation(); const newId = tracingCircuitId === recCircuitIds[0] ? null : recCircuitIds[0]; tracingCircuitId = newId; if (newId) { expandedGroup = null; } }}
														class="text-[10px] flex items-center gap-1 {tracingCircuitId === recCircuitIds[0] ? 'text-amber-300' : 'text-amber-400/70 hover:text-amber-300'}"
													>
														<Icon icon="mdi:electric-switch" width={11} />
														{tracingCircuitId === recCircuitIds[0] ? 'Hide circuit' : 'Trace circuit'}
													</button>
												{/if}
												<button
													onclick={(e) => { e.stopPropagation(); popoverMinimized = true; }}
													class="text-[10px] text-sky-400/70 hover:text-sky-300 flex items-center gap-1"
												>
													<Icon icon="mdi:eye-outline" width={11} />
													Lines only
												</button>
												<button
													onclick={(e) => { e.stopPropagation(); removeReceptaclePin(popGroup.members[0]); }}
													class="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 ml-auto"
												>
													<Icon icon="mdi:map-marker-remove" width={11} />
													Remove pin
												</button>
											</div>
											{/if}
										</div>
									</div>
									{:else}
										<!-- Minimized: small "show details" pill near the marker -->
										<button
											class="absolute z-20 pointer-events-auto flex items-center gap-1 px-2 py-1 rounded-full bg-slate-800/90 border border-slate-500/60 shadow-lg text-[10px] text-slate-300 hover:text-white transition-colors -translate-x-1/2"
											style="left: {popGroup.x * 100}%; top: calc({popGroup.y * 100}% + {popGroupFlip ? '-28' : '28'}px)"
											onclick={(e) => { e.stopPropagation(); popoverMinimized = false; }}
										>
											<Icon icon="mdi:chevron-up" width={12} />
											Details
										</button>
									{/if}
								{/if}
							{/if}
							<!-- Room detail popover (anchored near marker, both modes) -->
								{#if activePanel.areaId}
								{@const selectedArea = areas.find(a => a.id === activePanel.areaId)}
								{#if selectedArea}
									{@const areaLoads = allLoads.filter(l => l.fields.Area_id === selectedArea.id)}
									{@const areaRecs = allReceptacles.filter(r => r.fields.Area_id === selectedArea.id)}
									{@const areaPos = getAreaPosition(selectedArea)}
									{#if areaPos}
										{@const roomPopFlip = areaPos.y > 0.55}
											<div
												class="absolute z-30 w-[200px] sm:w-[240px] pointer-events-auto {roomPopFlip ? '-translate-y-full' : ''}"
												style="left: clamp(8px, calc({areaPos.x * 100}% - 100px), calc(100% - 208px)); {roomPopFlip ? `top: calc(${areaPos.y * 100}% - 20px)` : `top: calc(${areaPos.y * 100}% + 20px)`}"
												onclick={(e) => e.stopPropagation()}
											>
												<div class="bg-slate-900/95 border border-indigo-500/40 rounded-lg shadow-xl backdrop-blur-sm p-2.5 space-y-1.5 max-h-[240px] overflow-y-auto">
												<div class="flex items-center justify-between">
													<div class="flex items-center gap-1.5">
														<span class="w-4 h-4 rounded-full bg-indigo-500/80 flex items-center justify-center">
															<Icon icon="mdi:home-outline" width={9} class="text-white" />
														</span>
														<span class="text-[11px] font-medium text-white">{selectedArea.fields.Name}</span>
													</div>
													<button onclick={(e) => { e.stopPropagation(); activePanel = { areaId: 0, mode: null }; }} class="text-slate-500 hover:text-white text-[10px] px-1">✕</button>
												</div>
												{#if areaLoads.length > 0}
													{@const showAllLoads = expandedOverflow[`popover-loads-${selectedArea?.id}`]}
													<div>
														<p class="text-[9px] text-orange-300 font-medium mb-0.5">Loads ({areaLoads.length})</p>
														{#each (showAllLoads ? areaLoads : areaLoads.slice(0, 8)) as load}
															{@const m = getDeviceMarker(load, 'load')}
															{@const isPlaced = load.fields.Floorplan_Id != null}
															<!-- svelte-ignore a11y_no_static_element_interactions -->
															<div
																class="flex items-center gap-1.5 text-[10px] py-0.5 {isPlaced ? 'hover:bg-slate-700/40 rounded cursor-pointer' : ''}"
																onclick={(e) => { e.stopPropagation(); if (isPlaced) { activePanel = { areaId: 0, mode: null }; selectedLoadId = load.id; expandedGroup = null; } }}
															>
																<span class="w-3.5 h-3.5 rounded-full {m.bg} flex items-center justify-center shrink-0">
																	<Icon icon={m.icon} width={8} class="text-white" />
																</span>
																<Tooltip text={getDisplayName(load, 'Load')} side="bottom" class="min-w-0 flex-1">
																<span class="text-slate-300 truncate block {isPlaced ? '' : 'opacity-60'}">{getDisplayName(load, 'Load')}</span>
															</Tooltip>
																{#if !isPlaced}
																	<button
																		onclick={(e) => { e.stopPropagation(); if (!editingMarkers) editingMarkers = true; placingItem = { type: 'load', id: load.id }; expandedCluster = null; activePanel = { areaId: 0, mode: null }; }}
																		class="ml-auto shrink-0 text-orange-400 hover:text-orange-200"
																		title="Place on floorplan"
																	>
																		<Icon icon="mdi:map-marker-plus" width={12} />
																	</button>
																{/if}
															</div>
														{/each}
														{#if !showAllLoads && areaLoads.length > 8}
															<button onclick={(e) => { e.stopPropagation(); expandedOverflow = { ...expandedOverflow, [`popover-loads-${selectedArea?.id}`]: true }; }} class="text-[9px] text-amber-400 hover:text-amber-200 cursor-pointer mt-0.5">+{areaLoads.length - 8} more…</button>
														{/if}
													</div>
												{/if}
												{#if areaRecs.length > 0}
													{@const showAllRecs = expandedOverflow[`popover-recs-${selectedArea?.id}`]}
													<div>
														<p class="text-[9px] text-indigo-300 font-medium mb-0.5">Receptacles ({areaRecs.length})</p>
														{#each (showAllRecs ? areaRecs : areaRecs.slice(0, 8)) as rec}
															{@const m = getDeviceMarker(rec, 'receptacle')}
															{@const isPlaced = rec.fields.Floorplan_Id != null}
															<!-- svelte-ignore a11y_no_static_element_interactions -->
															<div
																class="flex items-center gap-1.5 text-[10px] py-0.5 {isPlaced ? 'hover:bg-slate-700/40 rounded cursor-pointer' : ''}"
																onclick={(e) => { e.stopPropagation(); if (isPlaced) { activePanel = { areaId: 0, mode: null }; selectedLoadId = null; expandedGroup = getGroupKeyForRec(rec); } }}
															>
																<span class="w-3.5 h-3.5 rounded-full {m.bg} flex items-center justify-center shrink-0">
																	<Icon icon={m.icon} width={8} class="text-white" />
																</span>
																<Tooltip text={getDisplayName(rec, 'Receptacle')} side="bottom" class="min-w-0 flex-1">
																<span class="text-slate-300 truncate block {isPlaced ? '' : 'opacity-60'}">{getDisplayName(rec, 'Receptacle')}</span>
															</Tooltip>
																{#if !isPlaced}
																	<button
																		onclick={(e) => { e.stopPropagation(); if (!editingMarkers) editingMarkers = true; placingItem = { type: 'receptacle', id: rec.id }; expandedCluster = null; activePanel = { areaId: 0, mode: null }; }}
																		class="ml-auto shrink-0 text-indigo-400 hover:text-indigo-200"
																		title="Place on floorplan"
																	>
																		<Icon icon="mdi:map-marker-plus" width={12} />
																	</button>
																{/if}
															</div>
														{/each}
														{#if !showAllRecs && areaRecs.length > 8}
															<button onclick={(e) => { e.stopPropagation(); expandedOverflow = { ...expandedOverflow, [`popover-recs-${selectedArea?.id}`]: true }; }} class="text-[9px] text-indigo-400 hover:text-indigo-200 cursor-pointer mt-0.5">+{areaRecs.length - 8} more…</button>
														{/if}
													</div>
												{/if}
													{#if areaLoads.length === 0 && areaRecs.length === 0}
														<p class="text-[9px] text-slate-500">No devices yet.</p>
													{/if}
													<!-- Remove room pin -->
													<div class="border-t border-slate-700/50 pt-1.5">
														<button
															onclick={(e) => { e.stopPropagation(); removePin(selectedArea); }}
															class="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1"
														>
															<Icon icon="mdi:map-marker-remove" width={12} />
															Remove room pin
														</button>
													</div>
												</div>
											</div>
										{/if}
									{/if}
								{/if}
							<!-- Panel popover -->
							{#if selectedPanelMarkerId}
								{@const popPanel = allPanels.find(p => p.id === selectedPanelMarkerId)}
								{#if popPanel && popPanel.fields.Floorplan_X != null}
									{@const panelCircuitsForPop = allCircuits.filter(c => { const p = c.fields.Panel as { id: number } | undefined; return p && p.id === selectedPanelMarkerId; }).sort((a, b) => (a.fields.Number as number || 0) - (b.fields.Number as number || 0))}
									{@const leftCols = panelCircuitsForPop.filter(c => (c.fields.Number as number) % 2 === 1)}
									{@const rightCols = panelCircuitsForPop.filter(c => (c.fields.Number as number) % 2 === 0)}
									{@const panelPopFlip = (popPanel.fields.Floorplan_Y as number) > 0.55}
										{@const panelPopX = popPanel.fields.Floorplan_X as number}
										{@const panelXAlign = panelPopX < 0.25 ? 'left' : panelPopX > 0.75 ? 'right' : 'center'}
										{#if !popoverMinimized}
										<div
											class="absolute z-20 pointer-events-auto {panelPopFlip ? '-translate-y-full' : ''} {panelXAlign === 'center' ? '-translate-x-1/2' : panelXAlign === 'right' ? '-translate-x-full' : ''}"
											style="left: {panelPopX * 100}%; {panelPopFlip ? `top: calc(${(popPanel.fields.Floorplan_Y as number) * 100}% - 20px)` : `top: calc(${(popPanel.fields.Floorplan_Y as number) * 100}% + 20px)`}"
										>
											<div class="bg-slate-900/95 border border-slate-600/60 rounded-lg shadow-xl backdrop-blur-sm p-2.5 min-w-[240px] max-w-[320px] space-y-1.5" onclick={(e) => e.stopPropagation()}>
											<!-- Header -->
											<div class="flex items-center gap-2 pb-1.5 border-b border-slate-700/50">
												<Icon icon="lucide:plug-zap" width={14} class="text-amber-400" />
												<span class="text-[11px] font-semibold text-white">{popPanel.fields.Name || 'Panel'}</span>
												<span class="ml-auto text-[9px] text-slate-400">{panelCircuitsForPop.length} circuits</span>
												<button onclick={(e) => { e.stopPropagation(); popoverMinimized = true; }} class="ml-1 p-0.5 rounded hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors" aria-label="Lines only" use:tooltip={'Lines only'}>
													<Icon icon="mdi:eye-outline" width={12} />
												</button>
												<button onclick={(e) => { e.stopPropagation(); selectedPanelMarkerId = null; }} class="p-0.5 rounded hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors" aria-label="Close">
													<Icon icon="mdi:close" width={12} />
												</button>
											</div>
											<!-- Mini schematic: two columns -->
											<div class="grid grid-cols-2 gap-1 max-h-[200px] overflow-y-auto">
												<!-- Left column (odd) -->
												<div class="space-y-0.5">
													{#each leftCols as circuit}
														{@const amps = circuit.fields.Amps as number | undefined}
														<button
															onclick={(e) => { e.stopPropagation(); const newId = tracingCircuitId === circuit.id ? null : circuit.id; tracingCircuitId = newId; if (newId) selectedPanelMarkerId = null; }}
															class="flex items-center gap-1 px-1 py-0.5 rounded w-full text-left transition-colors {tracingCircuitId === circuit.id ? 'bg-amber-500/20 border border-amber-500/40' : 'bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60'}"
														>
															<span class="text-[8px] font-bold text-amber-400 w-3 text-right" style="font-variant-numeric: tabular-nums">{circuit.fields.Number}</span>
															<span class="text-[9px] text-white truncate flex-1">{circuit.fields.Name || '—'}</span>
															<span class="text-[8px] text-slate-400 shrink-0" style="font-variant-numeric: tabular-nums">{amps || '?'}A</span>
														</button>
													{/each}
												</div>
												<!-- Right column (even) -->
												<div class="space-y-0.5">
													{#each rightCols as circuit}
														{@const amps = circuit.fields.Amps as number | undefined}
														<button
															onclick={(e) => { e.stopPropagation(); const newId = tracingCircuitId === circuit.id ? null : circuit.id; tracingCircuitId = newId; if (newId) selectedPanelMarkerId = null; }}
															class="flex items-center gap-1 px-1 py-0.5 rounded w-full text-left transition-colors {tracingCircuitId === circuit.id ? 'bg-amber-500/20 border border-amber-500/40' : 'bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60'}"
														>
															<span class="text-[8px] font-bold text-amber-400 w-3 text-right" style="font-variant-numeric: tabular-nums">{circuit.fields.Number}</span>
															<span class="text-[9px] text-white truncate flex-1">{circuit.fields.Name || '—'}</span>
															<span class="text-[8px] text-slate-400 shrink-0" style="font-variant-numeric: tabular-nums">{amps || '?'}A</span>
														</button>
													{/each}
												</div>
											</div>
											<!-- Link to full panel view -->
											<a href="/panels" class="block text-center text-[9px] text-indigo-400 hover:text-indigo-300 pt-1 border-t border-slate-700/50">
												View full panel →
											</a>
										</div>
									</div>
									{/if}
								{/if}
							{/if}
						</div>
					</div>
					</div>

					<!-- Edit mode: placement panel -->
					{#if editingMarkers}
						{@const unplaced = getUnplacedAreas()}
						{@const unplacedLoads = getUnplacedLoads()}
						{@const unplacedRecs = getUnplacedReceptacles()}
						{@const unplacedPanels = allPanels.filter(p => !(p.fields.Floorplan_X != null && p.fields.Floorplan_Y != null && p.fields.Floorplan_Id))}
						<div class="bg-slate-800/60 rounded-xl border border-slate-700/40 p-3 space-y-3">
							<!-- Rooms -->
							<div>
								<p class="text-[10px] font-semibold text-indigo-300 uppercase tracking-wide mb-1">Rooms</p>
								{#if unplaced.length > 0}
									<div class="flex flex-wrap gap-1.5">
										{#each unplaced as area}
											<button
												onclick={() => { placingItem = { type: 'room', areaId: area.id }; expandedCluster = null; }}
												class="px-2 py-0.5 rounded text-[10px] transition-colors {placingItem?.type === 'room' && placingItem?.areaId === area.id ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-400/50' : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white'}"
											>
												{area.fields.Name || 'Room'}
											</button>
										{/each}
									</div>
								{:else}
									<p class="text-[10px] text-emerald-400">✓ All placed</p>
								{/if}
							</div>
							<!-- Loads -->
							<div>
								<p class="text-[10px] font-semibold text-amber-300 uppercase tracking-wide mb-1">Loads ({unplacedLoads.length} unplaced)</p>
								{#if unplacedLoads.length > 0}
									{@const showAllEditLoads = expandedOverflow['edit-loads']}
									<div class="flex flex-wrap gap-1.5 {showAllEditLoads ? 'max-h-48' : 'max-h-20'} overflow-y-auto">
										{#each (showAllEditLoads ? unplacedLoads : unplacedLoads.slice(0, 20)) as load}
											<button
												onclick={() => { placingItem = { type: 'load', id: load.id }; expandedCluster = null; }}
												class="px-2 py-0.5 rounded text-[10px] transition-colors {placingItem?.type === 'load' && placingItem?.id === load.id ? 'bg-amber-500/30 text-amber-200 border border-amber-400/50' : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white'}"
											>
												{getDisplayName(load, 'Load')}</button>
										{/each}
									</div>
									{#if !showAllEditLoads && unplacedLoads.length > 20}
										<button onclick={() => { if (unplacedLoads.length > 40) { overflowModal = { title: `Unplaced Loads (${unplacedLoads.length})`, items: unplacedLoads.map(l => ({ record: l, type: 'load' })) }; } else { expandedOverflow = { ...expandedOverflow, ['edit-loads']: true }; } }} class="text-[9px] text-amber-400 hover:text-amber-200 cursor-pointer mt-1">+{unplacedLoads.length - 20} more…</button>
									{/if}
								{:else}
									<p class="text-[10px] text-emerald-400">✓ All placed</p>
								{/if}
							</div>
							<!-- Receptacles -->
							<div>
								<p class="text-[10px] font-semibold text-indigo-300 uppercase tracking-wide mb-1">Receptacles ({unplacedRecs.length} unplaced)</p>
								{#if unplacedRecs.length > 0}
									{@const showAllEditRecs = expandedOverflow['edit-recs']}
									<div class="flex flex-wrap gap-1.5 {showAllEditRecs ? 'max-h-48' : 'max-h-24'} overflow-y-auto">
										{#each (showAllEditRecs ? unplacedRecs : unplacedRecs.slice(0, 20)) as rec}
											{@const mates = getGangMates(rec).filter(m => !m.fields.Floorplan_Id)}
											<button
												onclick={() => { placingItem = { type: 'receptacle', id: rec.id }; expandedCluster = null; }}
												class="px-2 py-0.5 rounded text-[10px] transition-colors {placingItem?.type === 'receptacle' && placingItem?.id === rec.id ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-400/50' : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white'}"
											>
												{getDisplayName(rec, 'Receptacle')}{#if mates.length > 0} <span class="text-slate-500">+{mates.length}</span>{/if}
											</button>
										{/each}
									</div>
									{#if !showAllEditRecs && unplacedRecs.length > 20}
										<button onclick={() => { if (unplacedRecs.length > 40) { overflowModal = { title: `Unplaced Receptacles (${unplacedRecs.length})`, items: unplacedRecs.map(r => ({ record: r, type: 'receptacle' })) }; } else { expandedOverflow = { ...expandedOverflow, ['edit-recs']: true }; } }} class="text-[9px] text-indigo-400 hover:text-indigo-200 cursor-pointer mt-1">+{unplacedRecs.length - 20} more…</button>
									{/if}
								{:else}
									<p class="text-[10px] text-emerald-400">✓ All placed</p>
								{/if}
							</div>
							<!-- Panels -->
							<div>
								<p class="text-[10px] font-semibold text-amber-300 uppercase tracking-wide mb-1">Panels ({unplacedPanels.length} unplaced)</p>
								{#if unplacedPanels.length > 0}
									<div class="flex flex-wrap gap-1.5">
										{#each unplacedPanels as panel}
											<button
												onclick={() => { placingItem = { type: 'panel', id: panel.id }; expandedCluster = null; }}
												class="px-2 py-0.5 rounded text-[10px] transition-colors {placingItem?.type === 'panel' && placingItem?.id === panel.id ? 'bg-amber-500/30 text-amber-200 border border-amber-400/50' : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white'}"
											>
												{panel.fields.Name || 'Panel'}
											</button>
										{/each}
									</div>
								{:else}
									<p class="text-[10px] text-emerald-400">✓ All placed</p>
								{/if}
							</div>

							<div class="border-t border-slate-700/40 pt-2 flex gap-2">
								<button onclick={() => openQuickAdd()} class="px-3 py-1.5 rounded-lg text-xs bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 transition-colors">
									<Icon icon="mdi:plus" width={12} class="inline mr-1" />New Load
								</button>
								<button onclick={() => openQuickAddReceptacle()} class="px-3 py-1.5 rounded-lg text-xs bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 transition-colors">
									<Icon icon="mdi:plus" width={12} class="inline mr-1" />New Receptacle
								</button>
							</div>
						</div>
					{/if}
			{:else if floorplans.length === 0}
				<!-- Empty state: upload/paste -->
				<div class="border-2 border-dashed border-slate-700/60 rounded-xl p-8 text-center space-y-4">
					<div class="w-14 h-14 mx-auto rounded-full bg-indigo-500/10 flex items-center justify-center">
						<Icon icon="mdi:floor-plan" width={28} class="text-indigo-400" />
					</div>
					<div>
						<p class="text-sm font-medium text-white">Add a floorplan</p>
						<p class="text-xs text-slate-400 mt-1">Upload an image or paste a screenshot (Ctrl+V)</p>
					</div>
					<div class="flex gap-2 justify-center">
						<label class="cursor-pointer px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-500 transition-colors active:scale-[0.96] {uploading ? 'opacity-50 pointer-events-none' : ''}">
							{uploading ? 'Uploading…' : 'Choose Image'}
							<input
								type="file"
								accept="image/*"
								class="hidden"
								onchange={(e) => {
									const file = e.currentTarget.files?.[0];
									if (file) handleFloorplanUpload(file);
								}}
							/>
						</label>
					</div>
					<p class="text-[10px] text-slate-500">Supports: architect PDFs (as image), photos, screenshots, sketches</p>
				</div>
			{:else}
				<!-- Floorplan exists but no image (shouldn't happen, but handle gracefully) -->
				<p class="text-slate-400 text-center py-8">No image for this floor</p>
			{/if}
		</div>
	{:else}

	{#if loading}
		<!-- Skeleton: filter pills + search -->
		<div class="flex items-center gap-2 mb-3">
			<div class="h-8 w-14 rounded-lg bg-slate-700/60 animate-pulse"></div>
			<div class="h-8 w-24 rounded-lg bg-slate-700/40 animate-pulse"></div>
			<div class="h-8 w-16 rounded-lg bg-slate-700/40 animate-pulse"></div>
			<div class="h-8 flex-1 rounded-lg bg-slate-700/30 animate-pulse ml-auto"></div>
		</div>
		<!-- Skeleton: area cards -->
		<div class="space-y-2.5">
			{#each Array(5) as _}
				<div class="bg-slate-800/50 rounded-xl p-3.5 border border-slate-700/30 space-y-2">
					<div class="flex items-center gap-3">
						<div class="w-8 h-8 rounded-lg bg-slate-700/50 animate-pulse shrink-0"></div>
						<div class="flex-1 space-y-1.5">
							<div class="h-4 w-28 rounded bg-slate-700/50 animate-pulse"></div>
							<div class="h-3 w-16 rounded bg-slate-700/30 animate-pulse"></div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else if filteredAreas.length === 0}
		{#if searchQuery}
			<p class="text-slate-400 text-center py-8">No results</p>
		{:else}
			<div class="flex flex-col items-center justify-center py-16 gap-4">
				<div class="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center">
					<Icon icon="mdi:door-open" width={32} class="text-slate-500" />
				</div>
				<div class="text-center">
					<p class="text-slate-300 font-medium">No rooms yet</p>
					<p class="text-slate-500 text-sm mt-1">{isLocked ? 'Unlock this home in Settings to add rooms' : 'Create your first room to start organizing devices'}</p>
				</div>
				{#if !isLocked}
				<button
					onclick={() => { showCreateRoom = true; }}
					class="mt-2 inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-500 transition-background-color active:scale-[0.96]"
				>
					<Icon icon="mdi:plus" width={18} />
					Create Room
				</button>
				{/if}
			</div>
		{/if}
	{:else}
		<!-- Floor groups -->
		<div class="space-y-3">
			{#each floorGroups as [floorName, floorAreas]}
				{@const collapsed = collapsedFloors[floorName]}
				<div class="space-y-1.5">
					<!-- Floor header -->
					<button
						onclick={() => toggleFloor(floorName)}
						class="w-full flex items-center gap-2 px-2 py-2 rounded-md text-xs uppercase tracking-wider font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 transition-color,background-color cursor-pointer"
					>
						<Icon icon={getFloorIcon(floorName)} width={16} class="text-slate-400" />
						{floorName}
						<Icon icon="mdi:chevron-right" width={20} class="text-slate-500 ml-auto transition-transform duration-200" style="transform: rotate({collapsed ? '0deg' : '90deg'})" />
					</button>

					{#if !collapsed}
						<div transition:slide={{ duration: 200, easing: cubicOut }} class="space-y-1">
							{#each floorAreas as area}
								{@const f = area.fields}
								{@const icon = getRoomIcon(area)}
								{@const iconColor = getRoomColor(area)}
								{@const devices = getAreaDevices(area.id)}
								{@const loadCount = allLoads.filter((l) => (l.fields.Area as {id:number})?.id === area.id).length}
								{@const recCount = allReceptacles.filter((r) => (r.fields.Area as {id:number})?.id === area.id).length}
								{@const devicesActive = isPanelActive(area.id, 'devices')}
								{@const editActive = isPanelActive(area.id, 'edit')}
								{@const commentsActive = isPanelActive(area.id, 'comments')}

								{@const hasActivePanel = devicesActive || editActive || commentsActive}

								<div data-area-id={area.id} class="bg-slate-800/50 rounded-xl border transition-border-color {hasActivePanel ? 'border-indigo-500/60' : 'border-slate-700/50'} relative">
									<!-- Room header bar -->
									<div class="flex items-center gap-3 px-3 py-3 min-h-[52px] group">
										<!-- Colored icon -->
										<button
											onclick={() => togglePanel(area.id, 'devices')}
											class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
											style="background: {iconColor}30; color: {iconColor};"
										>
											<DynamicIcon icon={icon} size={22} class="block" />
										</button>

										<!-- Name + Counts -->
										<button
											onclick={() => togglePanel(area.id, 'devices')}
											class="flex-1 min-w-0 text-left"
										>
											<h3 class="font-semibold text-white text-sm truncate">{f.Name}</h3>
											<div class="flex items-center gap-3 mt-0.5">
												{#if loadCount > 0}
													<span title="{loadCount} load{loadCount !== 1 ? 's' : ''}" class="text-xs text-amber-400/80 flex items-center gap-1" style="font-variant-numeric: tabular-nums">
														<Icon icon="mdi:lightbulb-outline" width={13} class="text-amber-400" />{loadCount}
													</span>
												{/if}
												{#if recCount > 0}
													<span title="{recCount} receptacle{recCount !== 1 ? 's' : ''}" class="text-xs text-indigo-400/80 flex items-center gap-1" style="font-variant-numeric: tabular-nums">
														<Icon icon="mdi:power-socket-us" width={13} class="text-indigo-400" />{recCount}
													</span>
												{/if}
												{#if (f.Circuits as number) > 0}
													<span title="{f.Circuits} circuit{(f.Circuits as number) !== 1 ? 's' : ''}" class="text-xs text-emerald-400/80 flex items-center gap-1" style="font-variant-numeric: tabular-nums">
														<Icon icon="lucide:plug-zap" width={13} class="text-emerald-400" />{f.Circuits}
													</span>
												{/if}
											</div>
										</button>

										<!-- Action buttons: colored, decorated on hover, highlighted when active -->
										<div class="flex items-center gap-0.5 shrink-0">
											<button
												onclick={() => togglePanel(area.id, 'devices')}
												title="Devices"
												class="p-1.5 rounded-md transition-all {devicesActive ? 'text-indigo-400 bg-indigo-500/15 ring-1 ring-indigo-500/40' : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:text-indigo-400 hover:bg-indigo-500/10'}"
											>
												<Icon icon="mdi:format-list-bulleted" width={15} />
											</button>
											<button
												onclick={() => { if (!editActive) startEdit(area); else togglePanel(area.id, 'edit'); }}
												title="Edit"
												class="p-1.5 rounded-md transition-all {editActive ? 'text-amber-400 bg-amber-500/15 ring-1 ring-amber-500/40' : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:text-amber-400 hover:bg-amber-500/10'}"
											>
												<Icon icon="mdi:pencil-outline" width={15} />
											</button>
											<button
												onclick={() => toggleComments(area.id)}
												onmouseenter={() => fetchCommentCount(area.id)}
												title="Comments"
												class="relative p-1.5 rounded-md transition-all {commentsActive ? 'text-indigo-400 bg-indigo-500/15 ring-1 ring-indigo-500/40' : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:text-indigo-400 hover:bg-indigo-500/10'}"
											>
												<Icon icon="mdi:comment-outline" width={15} />
												{#if (commentCounts[area.id] ?? 0) > 0}
													<span class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold bg-indigo-500 text-white rounded-full" style="font-variant-numeric: tabular-nums">{commentCounts[area.id]}</span>
												{/if}
											</button>
											<div class="relative">
												<button
													onclick={() => { addMenuAreaId = addMenuAreaId === area.id ? null : area.id; }}
													title="Add"
													class="p-1.5 rounded-md text-slate-500 opacity-0 group-hover:opacity-100 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
												>
													<Icon icon="mdi:plus" width={15} />
												</button>
												{#if addMenuAreaId === area.id}
													<div class="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-20 min-w-[140px] py-1 animate-fade-in">
														<button
															onclick={() => { addMenuAreaId = null; openQuickAdd(area.id); }}
															class="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white transition-background-color"
														>
															<Icon icon="mdi:lightbulb-outline" width={14} class="text-amber-400" />
															Add Load
														</button>
														<button
															onclick={() => { addMenuAreaId = null; openQuickAddReceptacle(area.id); }}
															class="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white transition-background-color"
														>
															<Icon icon="mdi:power-socket-us" width={14} class="text-indigo-400" />
															Add Receptacle
														</button>
														<div class="border-t border-slate-700/50 my-1"></div>
														<button
															onclick={() => { addMenuAreaId = null; /* TODO: AI Scan */ }}
															class="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:bg-slate-700/60 hover:text-slate-300 transition-background-color"
														>
															<Icon icon="mdi:camera-plus" width={14} class="text-slate-500" />
															AI Scan (soon)
														</button>
													</div>
												{/if}
											</div>
										</div>
									</div>

									<!-- Panel content area -->
									{#if devicesActive || editActive || commentsActive}
										<div transition:slide={{ duration: 200, easing: cubicOut }} class="border-t border-slate-700/40">
										{#key activePanel.mode}
											<div in:fade={{ duration: 150 }}>
											<!-- Edit panel -->
											{#if editActive && editingArea?.id === area.id}
												<div class="px-3 pb-3">
											<div class="bg-slate-900/60 rounded-lg p-3 mt-2 border border-slate-600/50 space-y-3">
												<div>
													<label for="edit-name-{area.id}" class="text-xs text-slate-500 block mb-1">Name</label>
													<input id="edit-name-{area.id}" type="text" bind:value={editName}
														oninput={() => { editDirty = true; }}
														class="w-full bg-slate-800 border border-slate-600/50 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-border-color" />
												</div>
												<div>
													<span class="text-xs text-slate-500 block mb-1">Icon</span>
													<button onclick={() => { showIconPicker = true; }}
														class="flex items-center gap-2 bg-slate-800 border border-slate-600/50 rounded-md px-3 py-1.5 w-full hover:border-slate-500 transition-border-color">
														<span style="color: {iconColor}"><DynamicIcon icon={getRoomIcon(area)} size={18} /></span>
														<span class="text-xs text-slate-300 flex-1 text-left">{getRoomIcon(area)}</span>
														<span class="text-xs text-slate-500">Change</span>
													</button>
												</div>
												<div>
													<span class="text-xs text-slate-500 block mb-1">Color</span>
													<div class="flex gap-1.5 flex-wrap">
														{#each ['#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#10b981','#14b8a6','#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899','#f43f5e','#78716c','#64748b','#475569'] as color}
															<button
																onclick={() => { editDirty = true; if (editingArea) editingArea.fields['Icon Color'] = color; }}
																class="w-7 h-7 rounded-full border-2 transition-transform active:scale-[0.9] {iconColor === color ? 'border-white scale-110' : 'border-transparent'}"
																style="background: {color};"
															></button>
														{/each}
													</div>
												</div>
												<div class="flex gap-2">
													<button onclick={saveEdit} disabled={saving}
														class="flex-1 bg-indigo-600 text-white text-xs font-medium py-2 rounded-md hover:bg-indigo-500 transition-background-color active:scale-[0.96] disabled:opacity-50">
														{saving ? 'Saving…' : 'Save'}
													</button>
													<button onclick={() => { cancelEdit(); activePanel = { areaId: 0, mode: null }; }} class="px-3 text-xs text-slate-400 hover:text-white transition-color">Cancel</button>
												</div>
											</div>
										</div>
									{/if}

									<!-- Comments panel -->
									{#if commentsActive}
										<div class="px-3 pb-3">
											<div class="pt-2 space-y-2">
												{#if commentsLoading}
													<p class="text-xs text-slate-600">Loading…</p>
												{:else}
													{#each comments as c}
														<div class="text-xs">
															<p class="text-slate-300">{c.comment}</p>
															<p class="text-slate-600 mt-0.5">{formatTime(c.created_at)}</p>
														</div>
													{/each}
													{#if comments.length === 0}
														<p class="text-xs text-slate-600">No comments yet</p>
													{/if}
												{/if}
												<div class="flex gap-1.5 mt-1">
													<input type="text" bind:value={newComment} placeholder="Add a comment…"
														onkeydown={(e) => { if (e.key === 'Enter') addComment(area.id); }}
														class="flex-1 bg-slate-800 border border-slate-600/50 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-border-color" />
													<button onclick={() => addComment(area.id)} disabled={addingComment || !newComment.trim()}
														class="px-2.5 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 transition-background-color active:scale-[0.96] disabled:opacity-40">
														<Icon icon="mdi:send" width={14} />
													</button>
												</div>
											</div>
										</div>
									{/if}

									<!-- Devices panel -->
									{#if devicesActive}
										<div>
											{#if devices.length === 0}
												<p class="px-3 py-4 text-xs text-slate-600 text-center">No {deviceFilter === 'all' ? 'devices' : deviceFilter} in this room</p>
											{:else}
												{@const visibleDevices = showAllDevices[area.id] ? devices : devices.slice(0, 8)}
												{#each visibleDevices as item}
													{@const badge = getDeviceBadge(item)}
													{@const info = getCircuitInfo(item)}
													{@const itemCircuits = getDeviceCircuits(item)}
													{@const isExpanded = expandedDevice === `${area.id}-${item.type}-${item.record.id}`}
													<div class="border-t border-slate-700/30 first:border-t-0 group/row">
														<button
															onclick={() => { expandedDevice = isExpanded ? null : `${area.id}-${item.type}-${item.record.id}`; }}
															class="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-800/40 transition-background-color text-left"
														>
															{#if badge}
																<Icon icon={badge.icon} width={16} class="{badge.color.split(' ')[1] || 'text-slate-400'}" />
															{/if}
															<div class="flex-1 min-w-0">
																<p class="text-sm text-white truncate">{getDisplayName(item.record)}</p>
															</div>
															{#if item.type === 'load' && ((item.record.fields.Fixture_Count as number) || 1) > 1}
																<span class="px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 bg-amber-600/20 text-amber-400 border border-amber-500/30">
																	×{item.record.fields.Fixture_Count}
																</span>
															{/if}
															{#if badge}
																<span class="px-2 py-0.5 rounded text-[10px] font-medium shrink-0 flex items-center gap-1 {badge.color}">
																	<Icon icon={badge.icon} width={11} />
																	{badge.label}
																</span>
															{/if}
															<!-- Action buttons: hover-visible on desktop, always on touch -->
															<div class="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity">
																<span
																	onclick={(e) => { e.stopPropagation(); startEditDevice(item, area.id); }}
																	role="button"
																	tabindex="0"
																	title="Edit"
																	class="p-1.5 rounded-md hover:bg-slate-700/60 text-slate-500 hover:text-amber-400 transition-color,background-color"
																>
																	<Icon icon="mdi:pencil-outline" width={15} />
																</span>
																<span
																	onclick={(e) => { e.stopPropagation(); startMoveDevice(item, area.id); }}
																	role="button"
																	tabindex="0"
																	title="Move"
																	class="p-1.5 rounded-md hover:bg-slate-700/60 text-slate-500 hover:text-indigo-400 transition-color,background-color"
																>
																	<Icon icon="mdi:swap-horizontal" width={15} />
																</span>
																<span
																	onclick={(e) => { e.stopPropagation(); deleteDevice(item); }}
																	role="button"
																	tabindex="0"
																	title="Delete"
																	class="p-1.5 rounded-md hover:bg-slate-700/60 text-slate-500 hover:text-red-400 transition-color,background-color"
																>
																	<Icon icon="mdi:trash-can-outline" width={15} />
																</span>
															</div>
															<Icon icon="mdi:chevron-{isExpanded ? 'up' : 'down'}" width={14} class="text-slate-600 shrink-0" />
														</button>
														{#if isExpanded && (info || itemCircuits.length > 0)}
															<div transition:slide={{ duration: 150, easing: cubicOut }} class="px-3 pb-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
																{#if info}
																	<Icon icon="lucide:plug-zap" width={12} class="text-emerald-500/70" />
																	<span>{info}</span>
																{/if}
																{#each itemCircuits as circuit}
																	<a
																		href={getCircuitPanelHref(circuit)}
																		class="inline-flex items-center gap-1 rounded-md bg-cyan-500/10 px-2 py-1 font-medium text-cyan-300 hover:bg-cyan-500/20"
																	>
																		<Icon icon="mdi:electric-switch" width={12} />
																		View circuit {getCircuitNumber(circuit)}
																	</a>
																{/each}
															</div>
														{/if}
														<!-- Inline edit form -->
														{#if editingDevice?.record.id === item.record.id && editingDevice?.type === item.type}
															<LoadEditForm
																recordId={editingDevice.record.id}
																deviceType={editingDevice.type}
																record={editingDevice.record}
																allLoads={allLoads}
																onClose={() => { editingDevice = null; }}
																onSaved={handleDeviceSaved}
															/>
														{/if}
														<!-- Inline move picker -->
														{#if movingDevice?.record.id === item.record.id && movingDevice?.type === item.type}
															<div class="px-3 pb-3 flex gap-2 items-center">
																<select
																	bind:value={moveTargetAreaId}
																	class="flex-1 bg-slate-800 border border-slate-600/50 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 transition-border-color"
																>
																	<option value={null} disabled>Move to…</option>
																	{#each areas.filter((a) => a.id !== movingDevice?.areaId) as a}
																		<option value={a.id}>{a.fields.Name}</option>
																	{/each}
																</select>
																<button onclick={confirmMoveDevice} disabled={saving || !moveTargetAreaId} class="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 transition-background-color active:scale-[0.96] disabled:opacity-50">Move</button>
																<button onclick={() => { movingDevice = null; }} class="px-2 py-1.5 text-xs text-slate-400 hover:text-white transition-color">Cancel</button>
															</div>
														{/if}
													</div>
												{/each}
												{#if devices.length > 8 && !showAllDevices[area.id]}
													<button
														onclick={() => { showAllDevices = { ...showAllDevices, [area.id]: true }; }}
														class="w-full py-2.5 text-xs text-indigo-400 hover:text-indigo-300 bg-slate-800/30 transition-color"
													>
														Show all {devices.length} devices →
													</button>
												{/if}
											{/if}
										</div>
									{/if}
									</div>
									{/key}
									</div>
								{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
	{/if}
	</div>
</div>
{#if showIconPicker}
	<IconPicker
		value={editingArea ? getRoomIcon(editingArea) : ''}
		onselect={updateIcon}
		onclose={() => { showIconPicker = false; }}
	/>
{/if}

<!-- Quick Add Load modal -->
{#if showQuickAdd}
	<QuickAddLoad
		areas={areaOptions}
		preselectedAreaId={quickAddAreaId}
		onclose={() => { showQuickAdd = false; }}
		onsave={onLoadSaved}
	/>
{/if}

<!-- Quick Add Receptacle modal -->
{#if showQuickAddReceptacle}
	<QuickAddReceptacle
		areas={areaOptions}
		preselectedAreaId={quickAddAreaId}
		onclose={() => { showQuickAddReceptacle = false; }}
		onsave={onReceptacleSaved}
	/>
{/if}

<!-- FAB: Add Load (only in list view) -->
{#if viewMode === 'list' && !loading && areas.length > 0}
	<button
		onclick={() => openQuickAdd()}
		class="fixed bottom-24 right-4 z-20 w-12 h-12 bg-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-indigo-500 transition-background-color active:scale-[0.92]"
		aria-label="Add load"
	>
		<Icon icon="mdi:plus" width={24} />
	</button>
{/if}

<ConfirmDialog
	open={confirmDialog.open}
	title={confirmDialog.title}
	description={confirmDialog.description}
	variant={confirmDialog.variant}
	onConfirm={() => { confirmDialog.onConfirm(); confirmDialog.open = false; }}
	onCancel={() => { confirmDialog.open = false; }}
/>

<!-- Overflow modal for large device lists -->
{#if overflowModal}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onclick={() => { overflowModal = null; }}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[90vw] max-w-md max-h-[70vh] flex flex-col" onclick={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
				<h3 class="text-sm font-semibold text-white">{overflowModal.title}</h3>
				<button onclick={() => { overflowModal = null; }} class="text-slate-400 hover:text-white text-lg leading-none">✕</button>
			</div>
			<div class="overflow-y-auto flex-1 p-3 space-y-1">
				{#each overflowModal.items as item}
					{@const m = getDeviceMarker(item.record, item.type)}
					<button
						onclick={() => { placingItem = { type: item.type, id: item.record.id }; expandedCluster = null; overflowModal = null; }}
						class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs hover:bg-slate-800 transition-colors {placingItem?.id === item.record.id ? 'bg-slate-700 ring-1 ring-white/30' : ''}"
					>
						<span class="w-4 h-4 rounded-full {m.bg} flex items-center justify-center shrink-0">
							<Icon icon={m.icon} width={9} class="text-white" />
						</span>
						<span class="text-slate-200 truncate">{getDisplayName(item.record)}</span>
					</button>
				{/each}
			</div>
		</div>
	</div>
{/if}

<!-- Create Room Modal -->
{#if showCreateRoom}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onclick={() => { showCreateRoom = false; }}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[90vw] max-w-sm p-5" onclick={(e) => e.stopPropagation()}>
			<h3 class="text-base font-semibold text-white mb-4">Create Room</h3>
			<div class="space-y-3">
				<div>
					<label for="new-room-name" class="text-xs text-slate-400 block mb-1">Room Name</label>
					<input
						id="new-room-name"
						type="text"
						bind:value={newRoomName}
						placeholder="e.g. Living Room"
						class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-border-color"
						onkeydown={(e) => { if (e.key === 'Enter' && newRoomName.trim()) createRoom(); }}
					/>
				</div>
				<div class="relative">
					<label for="new-room-floor" class="text-xs text-slate-400 block mb-1">Floor (optional)</label>
					<input
						id="new-room-floor"
						type="text"
						bind:value={newRoomFloor}
						placeholder="e.g. 1st Floor, Basement"
						onfocus={() => { floorDropdownOpen = true; }}
						oninput={() => { floorDropdownOpen = true; }}
						onblur={() => { setTimeout(() => { floorDropdownOpen = false; }, 150); }}
						autocomplete="off"
						class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-border-color"
					/>
					{#if floorDropdownOpen && filteredFloorSuggestions.length > 0}
						<div class="absolute z-10 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600/50 rounded-lg shadow-xl overflow-hidden">
							{#each filteredFloorSuggestions as suggestion}
								<button
									type="button"
										onmousedown={(e) => { e.preventDefault(); newRoomFloor = suggestion; floorDropdownOpen = false; }}
									class="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-background-color"
								>{suggestion}</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
			<div class="flex gap-2 mt-5">
				<button
					onclick={() => { showCreateRoom = false; }}
					class="flex-1 px-4 py-2.5 bg-slate-700 text-slate-300 text-sm font-medium rounded-lg hover:bg-slate-600 transition-background-color"
				>Cancel</button>
				<button
					onclick={() => createRoom()}
					disabled={!newRoomName.trim() || creatingRoom}
					class="flex-1 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-500 transition-background-color disabled:opacity-50 active:scale-[0.96]"
				>{creatingRoom ? 'Creating…' : 'Create'}</button>
			</div>
		</div>
	</div>
{/if}
