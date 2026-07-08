<script lang="ts">
	import Icon from '@iconify/svelte';
	import { onMount, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { PrinterConfig as LabelPrinterConfig } from '$lib/services/label-printing/types';
	import EntityPicker from '$lib/components/energy/EntityPicker.svelte';
	import { dataStore, ensureLoaded, invalidate } from '$lib/stores/data.svelte';
	import { homeContext } from '$lib/stores/home-context.svelte';

	interface AiConfig {
		enabled: boolean;
		openWebUiUrl: string;
		openWebUiApiKey: string;
		openWebUiModel: string;
		askApiKey: string;
		askAuthRequired: boolean;
		updatedAt: string | null;
	}

	interface ConnectionStatus {
		connected: boolean;
		message: string;
		model: string;
		model_available: boolean | null;
		available_models: string[];
		nocodb_tool_available: boolean | null;
		matched_tools: string[];
		tools_endpoint_available: boolean;
		models_endpoint_available: boolean;
		chat_completions_available: boolean;
	}

	interface UnifiConfig {
		url: string;
		username: string;
		site: string;
		verifySsl: boolean;
		hasPassword: boolean;
		lastSyncAt: string | null;
		updatedAt: string | null;
	}

	interface UnifiTestResult {
		success: boolean;
		deviceCount: number;
		siteName: string;
		controllerVersion: string;
		message: string;
	}

	interface PrinterSettingsConfig extends LabelPrinterConfig {
		defaultCircuitFormat: 'compact' | 'detailed';
		updatedAt: string | null;
	}

	let { data } = $props<{ data: { config: AiConfig; printerConfig: PrinterSettingsConfig } }>();

	// Per-home integration config: track which home's config is loaded
	const currentHomeId = $derived(homeContext.selectedHomeId);
	const currentHomeName = $derived(
		dataStore.homes.find(h => h.id === currentHomeId)?.fields?.Name || 'Default'
	);

	let openWebUiUrl = $state(untrack(() => data.config.openWebUiUrl));
	let openWebUiApiKey = $state(untrack(() => data.config.openWebUiApiKey));
	let openWebUiModel = $state(untrack(() => data.config.openWebUiModel));
	let askApiKey = $state(untrack(() => data.config.askApiKey));
	let askAuthRequired = $state(untrack(() => data.config.askAuthRequired));
	let enabled = $state(untrack(() => data.config.enabled));
	let updatedAt = $state(untrack(() => data.config.updatedAt));

	let saving = $state(false);
	let testing = $state(false);
	let showOpenWebUiKey = $state(false);
	let showShortcutKey = $state(false);
	let status: ConnectionStatus | null = $state(null);

	// UniFi state
	let unifiUrl = $state('');
	let unifiUsername = $state('');
	let unifiPassword = $state('');
	let unifiSite = $state('default');
	let unifiVerifySsl = $state(true);
	let unifiHasPassword = $state(false);
	let unifiLastSyncAt: string | null = $state(null);
	let unifiUpdatedAt: string | null = $state(null);
	let unifiSaving = $state(false);
	let unifiTesting = $state(false);
	let unifiTestResult: UnifiTestResult | null = $state(null);
	let unifiSyncing = $state(false);
	let showUnifiPassword = $state(false);
	let unifiSites: Array<{ name: string; desc: string }> = $state([]);

	// Home Assistant state
	let haUrl = $state('');
	let haToken = $state('');
	let haEnabled = $state(false);
	let haHasToken = $state(false);
	let haUpdatedAt: string | null = $state(null);
	let haSaving = $state(false);
	let haTesting = $state(false);
	let haTestResult: { connected: boolean; version?: string; location_name?: string; error?: string } | null = $state(null);
	let showHaToken = $state(false);

	// Label printing state
	let printerTapeWidth: number = $state(untrack(() => data.printerConfig.tapeWidthMm ?? 15));
	let printerLabelLength: string = $state(untrack(() => String(data.printerConfig.labelLengthMm ?? 'continuous')));
	let printerCircuitFormat = $state(untrack(() => data.printerConfig.defaultCircuitFormat));
	let printerDensity = $state(untrack(() => data.printerConfig.density));
	let printerDpi = $state(untrack(() => data.printerConfig.dpi));
	let printerServiceUuid = $state(untrack(() => data.printerConfig.serviceUuid));
	let printerWriteCharUuid = $state(untrack(() => data.printerConfig.writeCharUuid));
	let printerChunkSize = $state(untrack(() => data.printerConfig.chunkSize));
	let printerChunkDelayMs = $state(untrack(() => data.printerConfig.chunkDelayMs));
	let printerUpdatedAt = $state(untrack(() => data.printerConfig.updatedAt));
	let printerSaving = $state(false);
	let showPrinterAdvanced = $state(false);

	// Solar entity config state (loaded per-home via $effect)
	let solarProductionEntity = $state('');
	let solarTodayEntity = $state('');
	let solarLifetimeEntity = $state('');
	let solarGridImportEntity = $state('');
	let solarGridExportEntity = $state('');
	let solarUtilityRate = $state(0.138);
	let solarUpdatedAt: string | null = $state(null);
	let solarSaving = $state(false);

	const hasHaConfig = $derived(Boolean(haUrl.trim() && (haToken.trim() || haHasToken)));

	// Load solar config from API (per-home)
	async function loadSolarConfig() {
		try {
			const params = currentHomeId ? `?homeId=${currentHomeId}` : '';
			const resp = await fetch(`/api/settings/solar${params}`);
			if (resp.ok) {
				const config = await resp.json();
				solarProductionEntity = config.productionEntity || '';
				solarTodayEntity = config.todayEntity || '';
				solarLifetimeEntity = config.lifetimeEntity || '';
				solarGridImportEntity = config.gridImportEntity || '';
				solarGridExportEntity = config.gridExportEntity || '';
				solarUtilityRate = config.utilityRatePerKwh ?? 0.138;
				solarUpdatedAt = config.updatedAt || null;
			} else {
				solarProductionEntity = '';
				solarTodayEntity = '';
				solarLifetimeEntity = '';
				solarGridImportEntity = '';
				solarGridExportEntity = '';
				solarUtilityRate = 0.138;
				solarUpdatedAt = null;
			}
		} catch { /* ignore */ }
	}

	// Reload all per-home configs when expanded home changes
	$effect(() => {
		const _homeId = expandedHomeId; // track dependency
		if (_homeId === null) return;
		// Temporarily set currentHomeId so load/save functions use the right home
		homeContext.selectedHomeId = _homeId;
		void loadHAConfig();
		void loadUnifiConfig();
		void loadSolarConfig();
		// Reset test results when switching homes
		haTestResult = null;
		unifiTestResult = null;
	});

	async function savePrinterSettings() {
		printerSaving = true;
		try {
			const response = await fetch('/api/settings/printer', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tapeWidthMm: Number(printerTapeWidth),
					labelLengthMm: printerLabelLength === 'continuous' ? 'continuous' : Number(printerLabelLength),
					dpi: printerDpi,
					density: Math.min(8, Math.max(1, Math.round(printerDensity))),
					serviceUuid: printerServiceUuid,
					writeCharUuid: printerWriteCharUuid,
					chunkSize: Math.max(1, Math.round(printerChunkSize)),
					chunkDelayMs: Math.max(1, Math.round(printerChunkDelayMs)),
					defaultCircuitFormat: printerCircuitFormat
				})
			});

			if (!response.ok) {
				throw new Error('Failed to save printer configuration.');
			}

			const savedConfig = (await response.json()) as PrinterSettingsConfig;
			printerTapeWidth = savedConfig.tapeWidthMm ?? 15;
			printerLabelLength = String(savedConfig.labelLengthMm ?? 'continuous');
			printerCircuitFormat = savedConfig.defaultCircuitFormat;
			printerDensity = savedConfig.density;
			printerDpi = savedConfig.dpi;
			printerServiceUuid = savedConfig.serviceUuid;
			printerWriteCharUuid = savedConfig.writeCharUuid;
			printerChunkSize = savedConfig.chunkSize;
			printerChunkDelayMs = savedConfig.chunkDelayMs;
			printerUpdatedAt = savedConfig.updatedAt;
			toast.success('Printer configuration saved.');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to save printer configuration.');
		} finally {
			printerSaving = false;
		}
	}

	async function saveSolarSettings() {
		solarSaving = true;
		try {
			const response = await fetch('/api/settings/solar', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					productionEntity: solarProductionEntity,
					todayEntity: solarTodayEntity,
					lifetimeEntity: solarLifetimeEntity,
					gridImportEntity: solarGridImportEntity,
					gridExportEntity: solarGridExportEntity,
					utilityRatePerKwh: Number(solarUtilityRate),
					homeId: currentHomeId || undefined
				}),
			});
			if (!response.ok) throw new Error('Save failed');
			const saved = await response.json();
			solarUpdatedAt = saved.updatedAt;
			toast.success('Solar configuration saved.');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to save solar configuration.');
		} finally {
			solarSaving = false;
		}
	}

	async function loadHAConfig() {
		try {
			const params = currentHomeId ? `?homeId=${currentHomeId}` : '';
			const resp = await fetch(`/api/settings/ha${params}`);
			if (resp.ok) {
				const config = await resp.json();
				haUrl = config.url || '';
				haEnabled = config.enabled || false;
				haHasToken = config.hasToken || false;
				haUpdatedAt = config.updatedAt || null;
			} else {
				// No config for this home yet
				haUrl = '';
				haEnabled = false;
				haHasToken = false;
				haUpdatedAt = null;
			}
		} catch { /* ignore */ }
	}

	async function saveHAConfig() {
		haSaving = true;
		try {
			const body: Record<string, unknown> = {
				url: haUrl,
				enabled: haEnabled,
				homeId: currentHomeId || undefined
			};
			if (haToken.trim()) {
				body.token = haToken;
			}

			const resp = await fetch('/api/settings/ha', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!resp.ok) throw new Error('Failed to save Home Assistant configuration.');

			const saved = await resp.json();
			haUrl = saved.url;
			haEnabled = saved.enabled;
			haHasToken = saved.hasToken;
			haUpdatedAt = saved.updatedAt;
			haToken = '';
			toast.success('Home Assistant configuration saved.');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to save HA configuration.');
		} finally {
			haSaving = false;
		}
	}

	async function testHAConnection() {
		haTesting = true;
		try {
			const body: Record<string, unknown> = {
				homeId: currentHomeId || undefined
			};
			if (haUrl.trim() && haToken.trim()) {
				body.url = haUrl;
				body.token = haToken;
			}
			const resp = await fetch('/api/settings/ha', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			haTestResult = await resp.json();

			if (haTestResult?.connected) {
				toast.success(`Connected to Home Assistant ${haTestResult.version || ''}`);
			} else {
				toast.error(haTestResult?.error || 'Connection failed.');
			}
		} catch (error) {
			haTestResult = { connected: false, error: error instanceof Error ? error.message : 'Connection test failed.' };
			toast.error(haTestResult.error!);
		} finally {
			haTesting = false;
		}
	}

	const hasUnifiConfig = $derived(Boolean(unifiUrl.trim() && unifiUsername.trim() && (unifiPassword.trim() || unifiHasPassword)));

	// Discovery state
	interface DiscoveryItem {
		mac: string;
		name: string;
		type: string;
		role: string;
		ip: string;
		is_wired: boolean;
		power_source: string;
		upstream_mac: string | null;
		status: 'matched' | 'suggested' | 'unmatched';
		nocodb_id?: number;
		nocodb_title?: string;
		confidence?: number;
		match_reason?: string;
		inferred_area_id?: number;
		inferred_area_name?: string;
	}

	let discoveryItems: DiscoveryItem[] = $state([]);
	let discoveryLoading = $state(false);
	let discoveryError = $state('');
	let discoverySummary: { matched: number; suggested: number; unmatched: number } | null = $state(null);
	let discoveryActionLoading: string | null = $state(null);
	let availableLoads: Array<{ id: number; title: string }> = $state([]);
	let discoveryAreas: Array<{ id: number; name: string }> = $state([]);
	let linkingMac: string | null = $state(null);
	let areaOverrides: Record<string, number | undefined> = $state({}); // mac → selected area id

	async function runDiscovery() {
		discoveryLoading = true;
		discoveryError = '';
		try {
			const resp = await fetch('/api/unifi/discovery');
			if (!resp.ok) {
				const err = await resp.json();
				throw new Error(err.error || 'Discovery failed');
			}
			const data = await resp.json();
			discoveryItems = data.items;
			discoverySummary = data.summary;
			availableLoads = data.availableLoads || [];
			discoveryAreas = data.areas || [];
			// Pre-populate area overrides from inferred values
			areaOverrides = {};
			for (const item of data.items) {
				if (item.inferred_area_id) {
					areaOverrides[item.mac] = item.inferred_area_id;
				}
			}
		} catch (error) {
			discoveryError = error instanceof Error ? error.message : 'Discovery failed';
			toast.error(discoveryError);
		} finally {
			discoveryLoading = false;
		}
	}

	async function acceptMatch(item: DiscoveryItem) {
		if (!item.nocodb_id) return;
		discoveryActionLoading = item.mac;
		try {
			const selectedAreaId = areaOverrides[item.mac];
			const resp = await fetch('/api/unifi/discovery', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'accept',
					mac: item.mac,
					name: item.name,
					role: item.role,
					power_source: item.power_source,
					nocodb_id: item.nocodb_id,
					area_id: selectedAreaId,
					upstream_mac: item.upstream_mac
				})
			});
			if (!resp.ok) throw new Error('Failed to accept match');
			toast.success(`Linked "${item.name}" → "${item.nocodb_title}"`);
			// Update local state
			const idx = discoveryItems.findIndex((d) => d.mac === item.mac);
			if (idx >= 0) {
				discoveryItems[idx] = { ...discoveryItems[idx], status: 'matched' };
				discoveryItems = [...discoveryItems];
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed');
		} finally {
			discoveryActionLoading = null;
		}
	}

	async function createFromDiscovery(item: DiscoveryItem) {
		discoveryActionLoading = item.mac;
		try {
			const selectedAreaId = areaOverrides[item.mac];
			const resp = await fetch('/api/unifi/discovery', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'create',
					mac: item.mac,
					name: item.name,
					role: item.role,
					power_source: item.power_source,
					area_id: selectedAreaId,
					upstream_mac: item.upstream_mac
				})
			});
			if (!resp.ok) throw new Error('Failed to create load');
			const result = await resp.json();
			const areaName = discoveryAreas.find((a) => a.id === selectedAreaId)?.name;
			toast.success(`Created "${item.name}"${areaName ? ` in ${areaName}` : ''}`);
			// Update local state
			const idx = discoveryItems.findIndex((d) => d.mac === item.mac);
			if (idx >= 0) {
				discoveryItems[idx] = { ...discoveryItems[idx], status: 'matched', nocodb_id: result.nocodb_id };
				discoveryItems = [...discoveryItems];
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed');
		} finally {
			discoveryActionLoading = null;
		}
	}

	async function linkToExisting(item: DiscoveryItem, loadId: number) {
		discoveryActionLoading = item.mac;
		linkingMac = null;
		try {
			const load = availableLoads.find((l) => l.id === loadId);
			const selectedAreaId = areaOverrides[item.mac];
			const resp = await fetch('/api/unifi/discovery', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'accept',
					mac: item.mac,
					name: item.name,
					role: item.role,
					power_source: item.power_source,
					nocodb_id: loadId,
					area_id: selectedAreaId,
					upstream_mac: item.upstream_mac
				})
			});
			if (!resp.ok) throw new Error('Failed to link device');
			toast.success(`Linked "${item.name}" → "${load?.title || `Load #${loadId}`}"`);
			const idx = discoveryItems.findIndex((d) => d.mac === item.mac);
			if (idx >= 0) {
				discoveryItems[idx] = { ...discoveryItems[idx], status: 'matched', nocodb_id: loadId, nocodb_title: load?.title };
				discoveryItems = [...discoveryItems];
			}
			// Remove from available loads
			availableLoads = availableLoads.filter((l) => l.id !== loadId);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed');
		} finally {
			discoveryActionLoading = null;
		}
	}

	async function loadUnifiConfig() {
		try {
			const params = currentHomeId ? `?homeId=${currentHomeId}` : '';
			const resp = await fetch(`/api/settings/unifi${params}`);
			if (resp.ok) {
				const config = (await resp.json()) as UnifiConfig;
				unifiUrl = config.url;
				unifiUsername = config.username;
				unifiSite = config.site;
				unifiVerifySsl = config.verifySsl;
				unifiHasPassword = config.hasPassword;
				unifiLastSyncAt = config.lastSyncAt;
				unifiUpdatedAt = config.updatedAt;
			} else {
				// No config for this home yet
				unifiUrl = '';
				unifiUsername = '';
				unifiSite = 'default';
				unifiVerifySsl = true;
				unifiHasPassword = false;
				unifiLastSyncAt = null;
				unifiUpdatedAt = null;
			}
		} catch { /* ignore */ }
	}

	async function saveUnifiConfig() {
		unifiSaving = true;
		try {
			const body: Record<string, unknown> = {
				url: unifiUrl,
				username: unifiUsername,
				site: unifiSite,
				verifySsl: unifiVerifySsl,
				homeId: currentHomeId || undefined
			};
			if (unifiPassword.trim()) {
				body.password = unifiPassword;
			}

			const resp = await fetch('/api/settings/unifi', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!resp.ok) throw new Error('Failed to save UniFi configuration.');

			const saved = (await resp.json()) as UnifiConfig;
			unifiUrl = saved.url;
			unifiUsername = saved.username;
			unifiSite = saved.site;
			unifiVerifySsl = saved.verifySsl;
			unifiHasPassword = saved.hasPassword;
			unifiUpdatedAt = saved.updatedAt;
			unifiPassword = '';
			toast.success('UniFi configuration saved.');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to save UniFi configuration.');
		} finally {
			unifiSaving = false;
		}
	}

	async function testUnifiConnection() {
		unifiTesting = true;
		try {
			const params = currentHomeId ? `?homeId=${currentHomeId}` : '';
			const resp = await fetch(`/api/unifi/test${params}`, { method: 'POST' });
			unifiTestResult = (await resp.json()) as UnifiTestResult;

			if (unifiTestResult.success) {
				toast.success(unifiTestResult.message);
				void fetchUnifiSites();
			} else {
				toast.error(unifiTestResult.message);
			}
		} catch (error) {
			unifiTestResult = {
				success: false,
				deviceCount: 0,
				siteName: '',
				controllerVersion: '',
				message: error instanceof Error ? error.message : 'Connection test failed.'
			};
			toast.error(unifiTestResult.message);
		} finally {
			unifiTesting = false;
		}
	}

	async function fetchUnifiSites() {
		try {
			const params = currentHomeId ? `?homeId=${currentHomeId}` : '';
			const resp = await fetch(`/api/unifi/sites${params}`);
			if (resp.ok) {
				const data = await resp.json();
				unifiSites = data.sites || [];
			}
		} catch { /* ignore */ }
	}

	async function syncUnifi() {
		unifiSyncing = true;
		try {
			const params = currentHomeId ? `?homeId=${currentHomeId}` : '';
			const resp = await fetch(`/api/unifi/sync${params}`, { method: 'POST' });
			const result = await resp.json();

			if (resp.ok) {
				const matched = result.matched?.length || 0;
				const unmatched = result.unmatched_unifi?.length || 0;
				toast.success(`Sync complete: ${matched} matched, ${unmatched} unmatched UniFi devices.`);
				unifiLastSyncAt = new Date().toISOString();
			} else {
				toast.error(result.error || 'Sync failed.');
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Sync failed.');
		} finally {
			unifiSyncing = false;
		}
	}

	const hasConfig = $derived(Boolean(openWebUiUrl.trim() && openWebUiApiKey.trim() && openWebUiModel.trim()));

	async function saveConfig(regenerateAskApiKey = false) {
		saving = true;
		try {
			const response = await fetch('/api/settings/ai', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					enabled,
					openWebUiUrl,
					openWebUiApiKey,
					openWebUiModel,
					askApiKey,
					askAuthRequired,
					regenerateAskApiKey
				})
			});

			if (!response.ok) {
				throw new Error('Failed to save configuration.');
			}

			const savedConfig = (await response.json()) as AiConfig;
			enabled = savedConfig.enabled;
			openWebUiUrl = savedConfig.openWebUiUrl;
			openWebUiApiKey = savedConfig.openWebUiApiKey;
			openWebUiModel = savedConfig.openWebUiModel;
			askApiKey = savedConfig.askApiKey;
				askAuthRequired = savedConfig.askAuthRequired;
				updatedAt = savedConfig.updatedAt;
			toast.success(regenerateAskApiKey ? 'API key regenerated.' : 'AI configuration saved.');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to save configuration.');
		} finally {
			saving = false;
		}
	}

	async function testConnection() {
		testing = true;
		try {
			const response = await fetch('/api/settings/ai/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					openWebUiUrl,
					openWebUiApiKey,
					openWebUiModel
				})
			});

			status = (await response.json()) as ConnectionStatus;

			if (response.ok && status.connected) {
				toast.success('Connection test succeeded.');
			} else {
				toast.error(status.message || 'Connection test failed.');
			}
		} catch (error) {
			status = {
				connected: false,
				message: error instanceof Error ? error.message : 'Connection test failed.',
				model: openWebUiModel,
				model_available: null,
				available_models: [],
				nocodb_tool_available: null,
				matched_tools: [],
				tools_endpoint_available: false,
				models_endpoint_available: false,
				chat_completions_available: false
			};
			toast.error(status.message);
		} finally {
			testing = false;
		}
	}

	async function copyShortcutKey() {
		try {
			await navigator.clipboard.writeText(askApiKey);
			toast.success('Shortcut API key copied.');
		} catch {
			toast.error('Clipboard copy failed.');
		}
	}

	// Tab navigation
	type SettingsTab = 'homes' | 'mapping' | 'labels' | 'integrations' | 'general';
	let activeTab: SettingsTab = $state('homes');

	const tabs: Array<{ id: SettingsTab; label: string; icon: string }> = [
		{ id: 'homes', label: 'Homes', icon: 'mdi:home-group' },
		{ id: 'integrations', label: 'AI & Services', icon: 'mdi:power-plug' },
		{ id: 'mapping', label: 'Mapping', icon: 'mdi:link-variant' },
		{ id: 'labels', label: 'Labels', icon: 'mdi:printer' },
		{ id: 'general', label: 'General', icon: 'mdi:cog' }
	];

	// Homes management state
	const homes = $derived(dataStore.homes);
	let showCreateHome = $state(false);
	let newHomeName = $state('');
	let newHomeAddress = $state('');
	let newHomeCity = $state('');
	let newHomeState = $state('');
	let creatingHome = $state(false);
	let editingHomeId: number | null = $state(null);
	let editHomeName = $state('');
	let editHomeAddress = $state('');
	let editHomeCity = $state('');
	let editHomeState = $state('');
	let savingHome = $state(false);
	let expandedHomeId: number | null = $state(null);

	async function createHome() {
		if (!newHomeName.trim()) return;
		creatingHome = true;
		try {
			const fields: Record<string, unknown> = { Name: newHomeName.trim() };
			if (newHomeAddress.trim()) fields.Address = newHomeAddress.trim();
			if (newHomeCity.trim()) fields.City = newHomeCity.trim();
			if (newHomeState.trim()) fields.State = newHomeState.trim();

			const resp = await fetch('/api/nocodb', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Home', fields })
			});
			if (!resp.ok) throw new Error('Failed to create home');
			toast.success(`Created "${newHomeName.trim()}"`);
			showCreateHome = false;
			newHomeName = '';
			newHomeAddress = '';
			newHomeCity = '';
			newHomeState = '';
			invalidate();
			await ensureLoaded();
		} catch {
			toast.error('Failed to create home');
		} finally {
			creatingHome = false;
		}
	}

	function startEditHome(home: { id: number; fields: Record<string, unknown> }) {
		editingHomeId = home.id;
		editHomeName = (home.fields.Name as string) || '';
		editHomeAddress = (home.fields.Address as string) || '';
		editHomeCity = (home.fields.City as string) || '';
		editHomeState = (home.fields.State as string) || '';
	}

	async function saveHome() {
		if (!editingHomeId || !editHomeName.trim()) return;
		savingHome = true;
		try {
			const fields: Record<string, unknown> = {
				Name: editHomeName.trim(),
				Address: editHomeAddress.trim(),
				City: editHomeCity.trim(),
				State: editHomeState.trim()
			};
			const resp = await fetch('/api/nocodb', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table: 'Home', id: editingHomeId, fields })
			});
			if (!resp.ok) throw new Error('Failed to save');
			toast.success('Home updated');
			editingHomeId = null;
			invalidate();
			await ensureLoaded();
		} catch {
			toast.error('Failed to update home');
		} finally {
			savingHome = false;
		}
	}

	async function deleteHome(id: number, name: string) {
		if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
		try {
			const resp = await fetch(`/api/nocodb?table=Home&id=${id}`, { method: 'DELETE' });
			if (!resp.ok) throw new Error('Failed to delete');
			toast.success(`Deleted "${name}"`);
			if (homeContext.selectedHomeId === id) {
				homeContext.selectedHomeId = null;
			}
			invalidate();
			await ensureLoaded();
		} catch {
			toast.error('Failed to delete home');
		}
	}

	// Device mapping state
	let mappingStats: { matched: number; pending: number; ignored: number } | null = $state(null);
	let mappingLoading = $state(false);
	let autoLinkMac = $state(true);
	let suggestFuzzy = $state(true);
	let autoIgnoreInfra = $state(false);
	let minConfidence = $state(70);

	async function loadMappingStats() {
		mappingLoading = true;
		try {
			const resp = await fetch('/api/devices/discovery');
			if (resp.ok) {
				const data = await resp.json();
				mappingStats = {
					matched: 0,
					pending: data.summary.suggested + data.summary.unmatched,
					ignored: data.summary.ignored
				};
			}
		} catch { /* ignore */ }
		finally { mappingLoading = false; }
	}

	onMount(() => {
		void ensureLoaded();
		if (hasConfig) {
			void testConnection();
		}
		// Per-home configs (HA, UniFi, Solar) are loaded by the $effect watching currentHomeId
	});
</script>

<div class="max-w-2xl mx-auto space-y-5">
	<!-- Settings header -->
	<header class="space-y-1">
		<h1 class="text-xl font-bold text-white">Settings</h1>
	</header>

	<!-- Tab navigation -->
	<div class="flex border-b border-slate-700/50 overflow-x-auto scrollbar-hide -mx-1 px-1">
		{#each tabs as tab}
			<button
				onclick={() => { activeTab = tab.id; if (tab.id === 'mapping') void loadMappingStats(); }}
				class="shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap
					{activeTab === tab.id
						? 'border-indigo-500 text-indigo-300'
						: 'border-transparent text-slate-500 hover:text-slate-300'}"
			>
				<Icon icon={tab.icon} width={14} />
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- === INTEGRATIONS TAB === -->
	{#if activeTab === 'integrations'}

	<header class="space-y-2">
		<h2 class="text-lg font-bold text-white" style="text-wrap: balance">AI Configuration</h2>
		<p class="text-sm text-slate-400" style="text-wrap: pretty">
			Configure Open-WebUI and the API key your Siri Shortcut should send to <code class="text-slate-300">/api/ask</code>.
		</p>
	</header>

	<section class="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-4 shadow-[0_16px_48px_rgba(15,23,42,0.28)] space-y-4">
		<div class="flex items-center justify-between gap-3 rounded-xl border border-slate-700/50 bg-slate-900/45 p-3">
			<div>
				<h2 class="text-sm font-semibold text-white">AI Assistant</h2>
				<p class="mt-0.5 text-xs text-slate-400">Turn chat, shortcuts, and AI-powered actions on or off app-wide.</p>
			</div>
			<button
				type="button"
				onclick={() => { enabled = !enabled; }}
				class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors {enabled ? 'bg-indigo-600' : 'bg-slate-700'}"
				role="switch"
				aria-checked={enabled}
				aria-label="Toggle AI Assistant"
			>
				<span class="inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform {enabled ? 'translate-x-6' : 'translate-x-1'}"></span>
			</button>
		</div>

		<div class="space-y-2">
			<label class="block text-xs font-semibold uppercase tracking-wider text-slate-400" for="openwebui-url">
				Open-WebUI URL
			</label>
			<input
				id="openwebui-url"
				type="url"
				bind:value={openWebUiUrl}
				placeholder="http://open-webui.example.com"
				class="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none transition-colors"
			/>
		</div>

		<div class="space-y-2">
			<label class="block text-xs font-semibold uppercase tracking-wider text-slate-400" for="openwebui-key">
				Open-WebUI API Key
			</label>
			<div class="relative">
				<input
					id="openwebui-key"
					type={showOpenWebUiKey ? 'text' : 'password'}
					bind:value={openWebUiApiKey}
					placeholder="sk-..."
					class="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3 pr-12 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none transition-colors"
				/>
				<button
					type="button"
					onclick={() => { showOpenWebUiKey = !showOpenWebUiKey; }}
					class="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-white active:scale-[0.96]"
					aria-label={showOpenWebUiKey ? 'Hide API key' : 'Show API key'}
				>
					<Icon icon={showOpenWebUiKey ? 'mdi:eye-off-outline' : 'mdi:eye-outline'} width={18} />
				</button>
			</div>
		</div>

		<div class="space-y-2">
			<label class="block text-xs font-semibold uppercase tracking-wider text-slate-400" for="openwebui-model">
				Model Name
			</label>
			<input
				id="openwebui-model"
				type="text"
				bind:value={openWebUiModel}
				placeholder="gpt-4o"
				class="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none transition-colors"
			/>
		</div>

		<div class="space-y-2">
			<div class="flex items-center justify-between gap-3">
				<div>
					<label class="block text-xs font-semibold uppercase tracking-wider text-slate-400">
						Require API Key
					</label>
					<p class="text-xs text-slate-500 mt-0.5">When off, <code class="text-slate-300">/api/ask</code> accepts unauthenticated requests (trusted network only).</p>
				</div>
				<button
					type="button"
					onclick={() => { askAuthRequired = !askAuthRequired; }}
					class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors {askAuthRequired ? 'bg-indigo-600' : 'bg-slate-700'}"
					role="switch"
					aria-checked={askAuthRequired}
				>
					<span class="inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform {askAuthRequired ? 'translate-x-6' : 'translate-x-1'}"></span>
				</button>
			</div>
		</div>

		<div class="space-y-2">
			<div class="flex items-center justify-between gap-3">
				<label class="block text-xs font-semibold uppercase tracking-wider text-slate-400" for="ask-api-key">
					Shortcut API Key
				</label>
				<button
					type="button"
					onclick={copyShortcutKey}
					class="inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-white active:scale-[0.96]"
				>
					<Icon icon="mdi:content-copy" width={14} />
					Copy
				</button>
			</div>
			<div class="relative">
				<input
					id="ask-api-key"
					type={showShortcutKey ? 'text' : 'password'}
					bind:value={askApiKey}
					class="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3 pr-12 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none transition-colors"
				/>
				<button
					type="button"
					onclick={() => { showShortcutKey = !showShortcutKey; }}
					class="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-white active:scale-[0.96]"
					aria-label={showShortcutKey ? 'Hide shortcut API key' : 'Show shortcut API key'}
				>
					<Icon icon={showShortcutKey ? 'mdi:eye-off-outline' : 'mdi:eye-outline'} width={18} />
				</button>
			</div>
			<p class="text-xs text-slate-500" style="text-wrap: pretty">
				Send this as either <code class="text-slate-300">Authorization: Bearer &lt;key&gt;</code> or <code class="text-slate-300">x-api-key</code>.
			</p>
		</div>

		<div class="flex flex-wrap gap-2 pt-1">
			<button
				type="button"
				onclick={() => void saveConfig(false)}
				disabled={saving}
				class="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(37,99,235,0.28)] transition-colors hover:bg-indigo-500 active:scale-[0.96] disabled:opacity-60"
			>
				{saving ? 'Saving…' : 'Save configuration'}
			</button>
			<button
				type="button"
				onclick={() => void testConnection()}
				disabled={testing || !hasConfig}
				class="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 active:scale-[0.96] disabled:opacity-50"
			>
				{testing ? 'Testing…' : 'Test connection'}
			</button>
			<button
				type="button"
				onclick={() => void saveConfig(true)}
				disabled={saving}
				class="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 active:scale-[0.96] disabled:opacity-50"
			>
				Regenerate shortcut key
			</button>
		</div>

		{#if updatedAt}
			<p class="text-xs text-slate-500">Last saved: {new Date(updatedAt).toLocaleString()}</p>
		{/if}
	</section>

	<section class="rounded-2xl border border-slate-700/60 bg-slate-800/35 p-4 shadow-[0_16px_48px_rgba(15,23,42,0.2)] space-y-3">
		<div class="flex items-center justify-between gap-3">
			<div>
				<h2 class="text-sm font-semibold text-white">Connection status</h2>
				<p class="text-xs text-slate-400">Tests chat completions, models, and tools endpoints.</p>
			</div>
			{#if status}
				<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium {status.connected ? 'bg-emerald-500/12 text-emerald-300' : 'bg-rose-500/12 text-rose-300'}">
					<Icon icon={status.connected ? 'mdi:check-circle-outline' : 'mdi:alert-circle-outline'} width={14} />
					{status.connected ? 'Connected' : 'Not connected'}
				</span>
			{/if}
		</div>

		{#if status}
			<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
				<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3">
					<p class="text-[11px] uppercase tracking-wider text-slate-500">Chat completions</p>
					<p class="mt-1 text-sm font-medium {status.chat_completions_available ? 'text-emerald-300' : 'text-rose-300'}">
						{status.chat_completions_available ? 'Working' : 'Failed'}
					</p>
					<p class="mt-1 text-xs text-slate-400">
						{status.chat_completions_available ? 'AI chat is functional' : 'AI chat will not work'}
					</p>
				</div>

				<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3">
					<p class="text-[11px] uppercase tracking-wider text-slate-500">Model</p>
					<p class="mt-1 text-sm font-medium text-white">{status.model || openWebUiModel}</p>
					<p class="mt-1 text-xs text-slate-400">
						{#if status.model_available === true}
							Returned by Open-WebUI
						{:else if status.model_available === false}
							Not found in model list
						{:else if !status.models_endpoint_available}
							Model endpoint unavailable
						{:else}
							Model list unavailable
						{/if}
					</p>
				</div>

				<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3">
					<p class="text-[11px] uppercase tracking-wider text-slate-500">Database connection</p>
					<p class="mt-1 text-sm font-medium text-white">
						{#if status.nocodb_tool_available === true}
							nocodb-electrical detected
						{:else if status.nocodb_tool_available === false}
							Not detected
						{:else}
							Unknown
						{/if}
					</p>
					<p class="mt-1 text-xs text-slate-400">
						{status.tools_endpoint_available ? 'Open-WebUI tools endpoint responded' : 'Fell back to connection-only test'}
					</p>
				</div>

				<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3">
					<p class="text-[11px] uppercase tracking-wider text-slate-500">Available models</p>
					<p class="mt-1 text-sm font-medium text-white">{status.available_models.length}</p>
					<p class="mt-1 text-xs text-slate-400" style="text-wrap: pretty">
						{status.available_models.slice(0, 3).join(', ') || 'No model names returned'}
					</p>
				</div>
			</div>

			<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3 text-sm text-slate-300" style="text-wrap: pretty">
				{status.message}
			</div>

			{#if status.matched_tools.length > 0}
				<div class="space-y-2">
					<p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Matched tools</p>
					<div class="flex flex-wrap gap-2">
						{#each status.matched_tools as toolName}
							<span class="rounded-full bg-cyan-500/12 px-2.5 py-1 text-xs text-cyan-300">
								{toolName}
							</span>
						{/each}
					</div>
				</div>
			{/if}
		{:else}
			<div class="rounded-xl border border-dashed border-slate-700/50 bg-slate-900/45 p-4 text-sm text-slate-400" style="text-wrap: pretty">
				Save or test your configuration to verify the Open-WebUI connection and attempt to detect the <code class="text-slate-300">nocodb-electrical</code> tool.
			</div>
		{/if}
	</section>

	{/if}

	<!-- Label Printing Section -->
	{#if activeTab === 'labels'}
	<header class="space-y-2 pt-4">
		<div class="flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800/80 text-indigo-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
				<Icon icon="mdi:printer-wireless" width={20} />
			</div>
			<div class="space-y-1">
				<h1 class="text-2xl font-bold text-white" style="text-wrap: balance">Label Printing</h1>
				<p class="text-sm text-slate-400" style="text-wrap: pretty">
					Set default Phomemo label sizes, circuit formats, and Bluetooth transport settings.
				</p>
			</div>
		</div>
	</header>

	<section class="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-4 shadow-[0_16px_48px_rgba(15,23,42,0.28)] space-y-4">
		<div class="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/45 p-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-indigo-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
				<Icon icon="mdi:printer-outline" width={20} />
			</div>
			<div>
				<h2 class="text-sm font-semibold text-white">Label Printing</h2>
				<p class="mt-0.5 text-xs text-slate-400">
					Defaults for panel directory, circuit, and device label templates.
				</p>
			</div>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<label class="block text-xs font-semibold uppercase tracking-wider text-slate-400" for="printer-tape-width">
					Tape Width
				</label>
				<select
					id="printer-tape-width"
					bind:value={printerTapeWidth}
					class="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-none transition-colors"
				>
					<option value={12}>12mm</option>
					<option value={15}>15mm</option>
				</select>
				<p class="text-xs text-slate-500">Physical tape roll width (label height).</p>
			</div>

			<div class="space-y-2">
				<label class="block text-xs font-semibold uppercase tracking-wider text-slate-400" for="printer-label-length">
					Label Length
				</label>
				<select
					id="printer-label-length"
					bind:value={printerLabelLength}
					class="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-none transition-colors"
				>
					<option value="30">30mm (pre-cut)</option>
					<option value="40">40mm (pre-cut)</option>
					<option value="50">50mm (pre-cut)</option>
					<option value="continuous">Continuous (cut to fit)</option>
				</select>
				<p class="text-xs text-slate-500">Pre-cut die-cut or continuous roll.</p>
			</div>
		</div>

		<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-[11px] uppercase tracking-wider text-slate-500">Print Area</p>
					<p class="mt-1 text-sm font-medium text-white" style="font-variant-numeric: tabular-nums">
						{printerLabelLength === 'continuous' ? '~50' : printerLabelLength}mm × {printerTapeWidth}mm
					</p>
					<p class="mt-1 text-xs text-slate-400">Width × Height at {printerDpi} DPI</p>
				</div>
				<div class="text-right">
					<p class="text-[11px] uppercase tracking-wider text-slate-500">Resolution</p>
					<p class="mt-1 text-sm font-medium text-white" style="font-variant-numeric: tabular-nums">{printerDpi} DPI</p>
				</div>
			</div>
		</div>

		<div class="space-y-2">
			<div class="flex items-center justify-between gap-3">
				<div>
					<p class="block text-xs font-semibold uppercase tracking-wider text-slate-400">
						Circuit Label Format
					</p>
					<p class="mt-0.5 text-xs text-slate-500">Choose the default layout for 40mm circuit labels.</p>
				</div>
			</div>
			<div class="grid gap-2 sm:grid-cols-2">
				<button
					type="button"
					onclick={() => { printerCircuitFormat = 'compact'; }}
					class="rounded-xl border px-4 py-3 text-left transition-colors active:scale-[0.96] {printerCircuitFormat === 'compact' ? 'border-indigo-500/70 bg-indigo-500/12 text-white' : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:bg-slate-800'}"
				>
					<span class="block text-sm font-semibold">Compact</span>
					<span class="mt-1 block text-xs text-slate-400">40 × 12mm for quick circuit IDs.</span>
				</button>
				<button
					type="button"
					onclick={() => { printerCircuitFormat = 'detailed'; }}
					class="rounded-xl border px-4 py-3 text-left transition-colors active:scale-[0.96] {printerCircuitFormat === 'detailed' ? 'border-indigo-500/70 bg-indigo-500/12 text-white' : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:bg-slate-800'}"
				>
					<span class="block text-sm font-semibold">Detailed</span>
					<span class="mt-1 block text-xs text-slate-400">40 × 20mm with extra circuit details.</span>
				</button>
			</div>
		</div>

		<div class="space-y-2">
			<div class="flex items-center justify-between gap-3">
				<label class="block text-xs font-semibold uppercase tracking-wider text-slate-400" for="printer-density">
					Print Density
				</label>
				<span class="rounded-full bg-slate-900/60 px-2.5 py-1 text-xs text-slate-300" style="font-variant-numeric: tabular-nums">
					{printerDensity}
				</span>
			</div>
			<div class="flex items-center gap-3">
				<input
					id="printer-density"
					type="range"
					min="1"
					max="8"
					step="1"
					bind:value={printerDensity}
					class="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-slate-700 accent-indigo-500"
				/>
				<input
					type="number"
					min="1"
					max="8"
					bind:value={printerDensity}
					class="w-20 rounded-xl border border-slate-700 bg-slate-900/85 px-3 py-2 text-center text-sm text-white focus:border-indigo-500 focus:outline-none transition-colors"
				/>
			</div>
			<p class="text-xs text-slate-500">Higher values print darker. Standard range is 1–8.</p>
		</div>

		<div class="rounded-xl border border-slate-700/50 bg-slate-900/45 p-3">
			<button
				type="button"
				onclick={() => { showPrinterAdvanced = !showPrinterAdvanced; }}
				class="flex min-h-[40px] w-full items-center justify-between gap-3 rounded-xl text-left text-sm font-semibold text-white transition-colors hover:text-indigo-200 active:scale-[0.99]"
				aria-expanded={showPrinterAdvanced}
				aria-controls="printer-advanced-settings"
			>
				<div>
					<p>Advanced Bluetooth Settings</p>
					<p class="mt-0.5 text-xs font-normal text-slate-400">Service and transport tuning for compatible BLE printers.</p>
				</div>
				<Icon icon={showPrinterAdvanced ? 'mdi:chevron-up' : 'mdi:chevron-down'} width={20} class="text-slate-400" />
			</button>

			{#if showPrinterAdvanced}
				<div id="printer-advanced-settings" class="mt-4 grid gap-4 sm:grid-cols-2">
					<div class="space-y-2 sm:col-span-2">
						<label class="block text-xs font-semibold uppercase tracking-wider text-slate-400" for="printer-service-uuid">
							Service UUID
						</label>
						<input
							id="printer-service-uuid"
							type="text"
							bind:value={printerServiceUuid}
							class="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-none transition-colors"
						/>
					</div>

					<div class="space-y-2 sm:col-span-2">
						<label class="block text-xs font-semibold uppercase tracking-wider text-slate-400" for="printer-write-char-uuid">
							Write Characteristic UUID
						</label>
						<input
							id="printer-write-char-uuid"
							type="text"
							bind:value={printerWriteCharUuid}
							class="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-none transition-colors"
						/>
					</div>

					<div class="space-y-2">
						<label class="block text-xs font-semibold uppercase tracking-wider text-slate-400" for="printer-chunk-size">
							Chunk Size
						</label>
						<input
							id="printer-chunk-size"
							type="number"
							min="1"
							bind:value={printerChunkSize}
							class="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-none transition-colors"
						/>
					</div>

					<div class="space-y-2">
						<label class="block text-xs font-semibold uppercase tracking-wider text-slate-400" for="printer-chunk-delay">
							Chunk Delay (ms)
						</label>
						<input
							id="printer-chunk-delay"
							type="number"
							min="1"
							bind:value={printerChunkDelayMs}
							class="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-none transition-colors"
						/>
					</div>
				</div>
			{/if}
		</div>

		<div class="flex flex-wrap gap-2 pt-1">
			<button
				type="button"
				onclick={() => void savePrinterSettings()}
				disabled={printerSaving}
				class="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(37,99,235,0.28)] transition-colors hover:bg-indigo-500 active:scale-[0.96] disabled:opacity-60"
			>
				{printerSaving ? 'Saving…' : 'Save'}
			</button>
		</div>

		{#if printerUpdatedAt}
			<p class="text-xs text-slate-500">Last saved: {new Date(printerUpdatedAt).toLocaleString()}</p>
		{/if}
	</section>
	{/if}

	<!-- Device Mapping Tab -->
	{#if activeTab === 'mapping'}

	<!-- Auto-Match Rules -->
	<header class="space-y-2">
		<h2 class="text-lg font-bold text-white">Device Mapping</h2>
		<p class="text-sm text-slate-400" style="text-wrap: pretty">
			Configure how discovered devices are matched to your electrical catalog.
		</p>
	</header>

	<section class="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-4 shadow-[0_16px_48px_rgba(15,23,42,0.28)] space-y-4">
		<h3 class="text-sm font-semibold text-slate-300">Auto-Match Rules</h3>
		<div class="space-y-3">
			<label class="flex items-center justify-between">
				<span class="text-xs text-slate-300">Auto-link on exact MAC match</span>
				<button
					type="button"
					onclick={() => { autoLinkMac = !autoLinkMac; }}
					class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors {autoLinkMac ? 'bg-indigo-500' : 'bg-slate-600'}"
					role="switch"
					aria-checked={autoLinkMac}
				>
					<span class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform {autoLinkMac ? 'translate-x-[18px]' : 'translate-x-[3px]'}"></span>
				</button>
			</label>
			<label class="flex items-center justify-between">
				<span class="text-xs text-slate-300">Suggest fuzzy name matches</span>
				<button
					type="button"
					onclick={() => { suggestFuzzy = !suggestFuzzy; }}
					class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors {suggestFuzzy ? 'bg-indigo-500' : 'bg-slate-600'}"
					role="switch"
					aria-checked={suggestFuzzy}
				>
					<span class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform {suggestFuzzy ? 'translate-x-[18px]' : 'translate-x-[3px]'}"></span>
				</button>
			</label>
			<label class="flex items-center justify-between">
				<span class="text-xs text-slate-300">Auto-ignore UniFi infrastructure (APs, switches)</span>
				<button
					type="button"
					onclick={() => { autoIgnoreInfra = !autoIgnoreInfra; }}
					class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors {autoIgnoreInfra ? 'bg-indigo-500' : 'bg-slate-600'}"
					role="switch"
					aria-checked={autoIgnoreInfra}
				>
					<span class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform {autoIgnoreInfra ? 'translate-x-[18px]' : 'translate-x-[3px]'}"></span>
				</button>
			</label>
			<div class="flex items-center justify-between">
				<span class="text-xs text-slate-300">Minimum confidence for suggestions</span>
				<select bind:value={minConfidence} class="bg-slate-900 border border-slate-600 rounded-md text-xs text-slate-200 px-2 py-1">
					<option value={60}>60%</option>
					<option value={70}>70%</option>
					<option value={80}>80%</option>
					<option value={90}>90%</option>
				</select>
			</div>
		</div>
	</section>

	<!-- Stats -->
	{#if mappingStats}
		<div class="grid grid-cols-3 gap-2">
			<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3 text-center">
				<p class="text-lg font-bold text-emerald-300" style="font-variant-numeric: tabular-nums">{mappingStats.matched}</p>
				<p class="text-[10px] uppercase tracking-wider text-slate-500">Matched</p>
			</div>
			<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3 text-center">
				<p class="text-lg font-bold text-amber-300" style="font-variant-numeric: tabular-nums">{mappingStats.pending}</p>
				<p class="text-[10px] uppercase tracking-wider text-slate-500">Pending</p>
			</div>
			<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3 text-center">
				<p class="text-lg font-bold text-slate-400" style="font-variant-numeric: tabular-nums">{mappingStats.ignored}</p>
				<p class="text-[10px] uppercase tracking-wider text-slate-500">Ignored</p>
			</div>
		</div>
	{/if}

	<!-- Quick actions -->
	<div class="flex gap-2">
		<button
			type="button"
			onclick={() => void loadMappingStats()}
			disabled={mappingLoading}
			class="flex-1 inline-flex min-h-[40px] items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-300 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-indigo-600/30 active:scale-[0.96] disabled:opacity-60"
		>
			<Icon icon={mappingLoading ? 'mdi:loading' : 'mdi:sync'} width={16} class="mr-1.5 {mappingLoading ? 'animate-spin' : ''}" />
			Sync Now
		</button>
		<a
			href="/devices/discovery"
			class="flex-1 inline-flex min-h-[40px] items-center justify-center rounded-xl bg-slate-700/50 text-slate-300 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-slate-700/80 active:scale-[0.96]"
		>
			<Icon icon="mdi:radar" width={16} class="mr-1.5" />
			View Discovery Queue
		</a>
	</div>

	<!-- Legacy discovery inline (kept for backward compatibility) -->
	<!-- UniFi Discovery Section -->
	<header class="space-y-2 pt-4">
		<h1 class="text-2xl font-bold text-white" style="text-wrap: balance">Device Discovery</h1>
		<p class="text-sm text-slate-400" style="text-wrap: pretty">
			Discover UniFi devices and clients, match them to existing loads, or create new load records.
		</p>
	</header>

	<section class="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-4 shadow-[0_16px_48px_rgba(15,23,42,0.28)] space-y-4">
		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				onclick={() => void runDiscovery()}
				disabled={discoveryLoading || !hasUnifiConfig}
				class="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(37,99,235,0.28)] transition-colors hover:bg-indigo-500 active:scale-[0.96] disabled:opacity-60"
			>
				<Icon icon={discoveryLoading ? 'mdi:loading' : 'mdi:radar'} width={16} class="mr-1.5 {discoveryLoading ? 'animate-spin' : ''}" />
				{discoveryLoading ? 'Discovering…' : 'Discover Devices'}
			</button>
		</div>

		{#if discoveryError}
			<div class="rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-sm text-rose-300">
				{discoveryError}
			</div>
		{/if}

		{#if discoverySummary}
			<div class="grid grid-cols-3 gap-2">
				<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3 text-center">
					<p class="text-lg font-bold text-emerald-300" style="font-variant-numeric: tabular-nums">{discoverySummary.matched}</p>
					<p class="text-[10px] uppercase tracking-wider text-slate-500">Matched</p>
				</div>
				<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3 text-center">
					<p class="text-lg font-bold text-amber-300" style="font-variant-numeric: tabular-nums">{discoverySummary.suggested}</p>
					<p class="text-[10px] uppercase tracking-wider text-slate-500">Suggested</p>
				</div>
				<div class="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3 text-center">
					<p class="text-lg font-bold text-slate-300" style="font-variant-numeric: tabular-nums">{discoverySummary.unmatched}</p>
					<p class="text-[10px] uppercase tracking-wider text-slate-500">New</p>
				</div>
			</div>
		{/if}

		<!-- Suggested Matches -->
		{#if discoveryItems.filter((i) => i.status === 'suggested').length > 0}
			<div>
				<h2 class="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-amber-400">
					Suggested Matches ({discoveryItems.filter((i) => i.status === 'suggested').length})
				</h2>
				<div class="space-y-2">
					{#each discoveryItems.filter((i) => i.status === 'suggested') as item}
						<div class="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
							<div class="flex items-center justify-between gap-2">
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium text-white truncate">{item.name}</p>
									<p class="text-[11px] text-slate-500 truncate">{item.mac} · {item.ip} · {item.role}</p>
								</div>
								<span class="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
									{Math.round((item.confidence || 0) * 100)}%
								</span>
							</div>
							<div class="flex items-center gap-2 text-xs text-slate-400">
								<Icon icon="mdi:arrow-right" width={12} />
								<span class="text-cyan-300 truncate">{item.nocodb_title}</span>
								{#if item.match_reason}
									<span class="text-slate-600">({item.match_reason})</span>
								{/if}
							</div>
								<!-- Area selector -->
								{#if discoveryAreas.length > 0}
									<div class="flex items-center gap-2">
										<span class="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">Room:</span>
										<select
											class="flex-1 rounded-lg border border-slate-700/50 bg-slate-900/70 px-2 py-1 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
											value={areaOverrides[item.mac] ?? ''}
											onchange={(e) => { areaOverrides[item.mac] = e.currentTarget.value ? Number(e.currentTarget.value) : undefined; }}
										>
											<option value="">No room assigned</option>
											{#each discoveryAreas as area}
												<option value={area.id}>{area.name}</option>
											{/each}
										</select>
										{#if item.inferred_area_name && areaOverrides[item.mac] === item.inferred_area_id}
											<span class="text-[10px] text-emerald-400 shrink-0">auto</span>
										{/if}
									</div>
								{/if}
								<div class="flex gap-2 pt-1">
								<button
									onclick={() => void acceptMatch(item)}
									disabled={discoveryActionLoading === item.mac}
									class="flex-1 rounded-lg bg-emerald-500/15 py-1.5 text-center text-xs font-semibold text-emerald-300 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.2)] transition-transform active:scale-[0.96] disabled:opacity-50"
								>
									{discoveryActionLoading === item.mac ? '…' : 'Accept Match'}
								</button>
								<button
									onclick={() => void createFromDiscovery(item)}
									disabled={discoveryActionLoading === item.mac}
									class="rounded-lg bg-slate-700/50 px-3 py-1.5 text-xs font-medium text-slate-300 transition-transform active:scale-[0.96] disabled:opacity-50"
								>
									Create New Instead
								</button>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Unmatched (Create Candidates) -->
		{#if discoveryItems.filter((i) => i.status === 'unmatched').length > 0}
			<div>
				<h2 class="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
					New Devices ({discoveryItems.filter((i) => i.status === 'unmatched').length})
				</h2>
				<div class="space-y-2">
					{#each discoveryItems.filter((i) => i.status === 'unmatched') as item}
						<div class="rounded-xl border border-slate-700/40 bg-slate-800/40 p-3 space-y-2">
							<div class="flex items-center gap-3">
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium text-white truncate">{item.name}</p>
									<p class="text-[11px] text-slate-500 truncate">{item.mac} · {item.ip} · {item.role} · {item.power_source}</p>
								</div>
							</div>
							<!-- Area selector -->
							{#if discoveryAreas.length > 0}
								<div class="flex items-center gap-2">
									<span class="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">Room:</span>
									<select
										class="flex-1 rounded-lg border border-slate-700/50 bg-slate-900/70 px-2 py-1 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
										value={areaOverrides[item.mac] ?? ''}
										onchange={(e) => { areaOverrides[item.mac] = e.currentTarget.value ? Number(e.currentTarget.value) : undefined; }}
									>
										<option value="">No room assigned</option>
										{#each discoveryAreas as area}
											<option value={area.id}>{area.name}</option>
										{/each}
									</select>
									{#if item.inferred_area_name && areaOverrides[item.mac] === item.inferred_area_id}
										<span class="text-[10px] text-emerald-400 shrink-0">auto</span>
									{/if}
								</div>
							{/if}
							<div class="flex gap-1.5">
								{#if availableLoads.length > 0}
									<button
										onclick={() => { linkingMac = linkingMac === item.mac ? null : item.mac; }}
										disabled={discoveryActionLoading === item.mac}
										class="rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-300 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.2)] transition-transform active:scale-[0.96] disabled:opacity-50"
									>
										Link Existing
									</button>
								{/if}
								<button
									onclick={() => void createFromDiscovery(item)}
									disabled={discoveryActionLoading === item.mac}
									class="rounded-lg bg-indigo-500/15 px-2.5 py-1.5 text-xs font-semibold text-indigo-300 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.2)] transition-transform active:scale-[0.96] disabled:opacity-50"
								>
									{discoveryActionLoading === item.mac ? '…' : 'Create Load'}
								</button>
							</div>
							{#if linkingMac === item.mac}
								<div class="rounded-lg border border-slate-700/50 bg-slate-900/70 p-2 space-y-1.5">
									<p class="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Select existing load to link:</p>
									<div class="max-h-40 overflow-y-auto space-y-1">
										{#each availableLoads as load}
											<button
												onclick={() => void linkToExisting(item, load.id)}
												class="w-full text-left rounded-md px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700/60 transition-colors truncate"
											>
												{load.title}
											</button>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Already Matched -->
		{#if discoveryItems.filter((i) => i.status === 'matched').length > 0}
			<details class="group">
				<summary class="cursor-pointer text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-400 select-none">
					Already Matched ({discoveryItems.filter((i) => i.status === 'matched').length})
					<Icon icon="mdi:chevron-down" width={14} class="inline-block transition-transform group-open:rotate-180" />
				</summary>
				<div class="mt-2 space-y-1.5">
					{#each discoveryItems.filter((i) => i.status === 'matched') as item}
						<div class="flex items-center gap-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10 px-3 py-2">
							<Icon icon="mdi:check-circle" width={14} class="shrink-0 text-emerald-400" />
							<div class="min-w-0 flex-1">
								<p class="text-xs text-white truncate">{item.name}</p>
								<p class="text-[10px] text-slate-500 truncate">{item.mac} → {item.nocodb_title}</p>
							</div>
						</div>
					{/each}
				</div>
			</details>
		{/if}

		{#if !discoverySummary && !discoveryError}
			<div class="rounded-xl border border-dashed border-slate-700/50 bg-slate-900/45 p-4 text-sm text-slate-400" style="text-wrap: pretty">
				Click "Discover Devices" to scan your UniFi network and match devices to your electrical catalog. Devices are matched by MAC address first, then by name similarity.
			</div>
		{/if}
	</section>
	{/if}

	<!-- === HOMES TAB === -->
	{#if activeTab === 'homes'}
	<header class="space-y-2">
		<h2 class="text-lg font-bold text-white">Homes</h2>
		<p class="text-sm text-slate-400" style="text-wrap: pretty">Manage your homes. Each home has its own rooms, panels, and integration connections.</p>
	</header>

	<section class="space-y-3">
		{#each homes as home}
			<div class="rounded-xl border border-slate-700/60 bg-slate-800/50 overflow-hidden">
				{#if editingHomeId === home.id}
					<div class="p-4 space-y-3">
						<div>
							<label class="text-xs text-slate-400 block mb-1">Name</label>
							<input type="text" bind:value={editHomeName} class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-border-color" />
						</div>
						<div class="grid grid-cols-3 gap-2">
							<div class="col-span-3 sm:col-span-1">
								<label class="text-xs text-slate-400 block mb-1">Address</label>
								<input type="text" bind:value={editHomeAddress} class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-border-color" />
							</div>
							<div>
								<label class="text-xs text-slate-400 block mb-1">City</label>
								<input type="text" bind:value={editHomeCity} class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-border-color" />
							</div>
							<div>
								<label class="text-xs text-slate-400 block mb-1">State</label>
								<input type="text" bind:value={editHomeState} class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-border-color" />
							</div>
						</div>
						<div class="flex gap-2">
							<button onclick={() => { editingHomeId = null; }} class="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-color">Cancel</button>
							<button onclick={() => saveHome()} disabled={!editHomeName.trim() || savingHome} class="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50 transition-background-color">{savingHome ? 'Saving…' : 'Save'}</button>
						</div>
					</div>
				{:else}
					<!-- Home card header -->
					<div class="flex items-center justify-between p-4">
						<div class="flex items-center gap-3">
							<div class="w-9 h-9 rounded-lg bg-slate-700 flex items-center justify-center">
								<Icon icon="mdi:home" width={20} class="text-slate-300" />
							</div>
							<div>
								<p class="text-sm font-medium text-white">{home.fields.Name}</p>
								{#if home.fields.City || home.fields.State}
									<p class="text-xs text-slate-500">{[home.fields.City, home.fields.State].filter(Boolean).join(', ')}</p>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-1">
							{#if homeContext.selectedHomeId === home.id}
								<span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-600/20 text-indigo-400 font-medium">Active</span>
							{/if}
							<button
								onclick={() => { expandedHomeId = expandedHomeId === home.id ? null : home.id; }}
								class="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors"
								title="Configure integrations"
							>
								<Icon icon="mdi:tune-variant" width={16} class="{expandedHomeId === home.id ? 'text-indigo-400' : ''}" />
							</button>
							<button onclick={() => startEditHome(home)} class="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors">
								<Icon icon="mdi:pencil" width={16} />
							</button>
							<button onclick={() => deleteHome(home.id, home.fields.Name as string)} class="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-700 transition-colors">
								<Icon icon="mdi:trash-can-outline" width={16} />
							</button>
						</div>
					</div>

					<!-- Expanded integrations panel -->
					{#if expandedHomeId === home.id}
					<div class="border-t border-slate-700/40 bg-slate-900/30 p-4 space-y-5">
						<!-- Home Assistant config -->
						<div class="space-y-3">
							<div class="flex items-center gap-2">
								<Icon icon="mdi:home-assistant" width={18} class="text-amber-400" />
								<h3 class="text-sm font-semibold text-white">Home Assistant</h3>
								{#if haTestResult?.connected}
									<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/12 text-emerald-300">Connected</span>
								{/if}
							</div>
							<div class="space-y-2">
								<input
									type="url"
									bind:value={haUrl}
									placeholder="http://homeassistant.example:8123"
									class="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-amber-500/50"
								/>
								<div class="flex gap-2">
									<input
										type={showHaToken ? 'text' : 'password'}
										bind:value={haToken}
										placeholder={haHasToken ? '••••••••  (saved — leave blank to keep)' : 'Long-lived access token'}
										class="flex-1 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-amber-500/50"
									/>
									<button
										onclick={() => { showHaToken = !showHaToken; }}
										class="rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-2 text-slate-400 hover:text-white transition-colors"
									>
										<Icon icon={showHaToken ? 'mdi:eye-off-outline' : 'mdi:eye-outline'} width={16} />
									</button>
								</div>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-xs text-slate-400">Enabled</span>
								<button
									type="button"
									onclick={() => { haEnabled = !haEnabled; }}
									class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors {haEnabled ? 'bg-amber-600' : 'bg-slate-700'}"
									role="switch"
									aria-checked={haEnabled}
								>
									<span class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform {haEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}"></span>
								</button>
							</div>
							<div class="flex flex-wrap gap-2">
								<button
									onclick={() => void saveHAConfig()}
									disabled={haSaving}
									class="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-amber-500 disabled:opacity-50 active:scale-[0.96]"
								>
									{haSaving ? 'Saving…' : 'Save'}
								</button>
								<button
									onclick={() => void testHAConnection()}
									disabled={haTesting || !hasHaConfig}
									class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:bg-slate-700 disabled:opacity-50 active:scale-[0.96]"
								>
									{haTesting ? 'Testing…' : 'Test'}
								</button>
							</div>
							{#if haTestResult && !haTestResult.connected && haTestResult.error}
								<p class="text-xs text-rose-400">{haTestResult.error}</p>
							{/if}
							{#if haTestResult?.connected}
								<p class="text-xs text-slate-500">v{haTestResult.version} — {haTestResult.location_name}</p>
							{/if}
						</div>

						<hr class="border-slate-700/40" />

						<!-- UniFi config -->
						<div class="space-y-3">
							<div class="flex items-center gap-2">
								<Icon icon="mdi:router-wireless" width={18} class="text-indigo-400" />
								<h3 class="text-sm font-semibold text-white">UniFi Network</h3>
								{#if unifiTestResult?.success}
									<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/12 text-emerald-300">Connected</span>
								{/if}
							</div>
							<div class="space-y-2">
								<input
									type="url"
									bind:value={unifiUrl}
									placeholder="https://unifi.local"
									class="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-indigo-500/50"
								/>
								<div class="grid grid-cols-2 gap-2">
									<input
										type="text"
										bind:value={unifiUsername}
										placeholder="Username"
										class="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-indigo-500/50"
									/>
									<div class="relative">
										<input
											type={showUnifiPassword ? 'text' : 'password'}
											bind:value={unifiPassword}
											placeholder={unifiHasPassword ? '••••••••' : 'Password'}
											class="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 pr-9 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-indigo-500/50"
										/>
										<button
											type="button"
											onclick={() => { showUnifiPassword = !showUnifiPassword; }}
											class="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
										>
											<Icon icon={showUnifiPassword ? 'mdi:eye-off-outline' : 'mdi:eye-outline'} width={14} />
										</button>
									</div>
								</div>
								<div class="grid grid-cols-2 gap-2">
									{#if unifiSites.length > 0}
										<select
											bind:value={unifiSite}
											class="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white focus:border-indigo-500/50 focus:outline-none transition-colors"
										>
											{#each unifiSites as site}
												<option value={site.name}>{site.desc} ({site.name})</option>
											{/each}
										</select>
									{:else}
										<input
											type="text"
											bind:value={unifiSite}
											placeholder="Site (default)"
											class="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-indigo-500/50"
										/>
									{/if}
									<div class="flex items-center gap-2 px-2">
										<span class="text-xs text-slate-400">Verify SSL</span>
										<button
											type="button"
											onclick={() => { unifiVerifySsl = !unifiVerifySsl; }}
											class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors {unifiVerifySsl ? 'bg-indigo-600' : 'bg-slate-700'}"
											role="switch"
											aria-checked={unifiVerifySsl}
										>
											<span class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform {unifiVerifySsl ? 'translate-x-[18px]' : 'translate-x-[3px]'}"></span>
										</button>
									</div>
								</div>
							</div>
							<div class="flex flex-wrap gap-2">
								<button
									onclick={() => void saveUnifiConfig()}
									disabled={unifiSaving}
									class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-indigo-500 disabled:opacity-50 active:scale-[0.96]"
								>
									{unifiSaving ? 'Saving…' : 'Save'}
								</button>
								<button
									onclick={() => void testUnifiConnection()}
									disabled={unifiTesting || !hasUnifiConfig}
									class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:bg-slate-700 disabled:opacity-50 active:scale-[0.96]"
								>
									{unifiTesting ? 'Testing…' : 'Test'}
								</button>
								<button
									onclick={() => void syncUnifi()}
									disabled={unifiSyncing || !hasUnifiConfig}
									class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:bg-slate-700 disabled:opacity-50 active:scale-[0.96]"
								>
									<Icon icon="mdi:sync" width={14} class="inline mr-1 {unifiSyncing ? 'animate-spin' : ''}" />
									{unifiSyncing ? 'Syncing…' : 'Sync'}
								</button>
							</div>
							{#if unifiTestResult && !unifiTestResult.success}
								<p class="text-xs text-rose-400">{unifiTestResult.message}</p>
							{/if}
							{#if unifiTestResult?.success}
								<p class="text-xs text-slate-500">{unifiTestResult.deviceCount} devices · {unifiTestResult.siteName || unifiSite}</p>
							{/if}
						</div>

						<hr class="border-slate-700/40" />

						<!-- Solar / Energy config -->
						<div class="space-y-3">
							<div class="flex items-center gap-2">
								<Icon icon="mdi:solar-power-variant" width={18} class="text-yellow-400" />
								<h3 class="text-sm font-semibold text-white">Solar & Energy</h3>
							</div>
							<div class="space-y-2">
								<div class="space-y-1">
									<label class="block text-[11px] uppercase tracking-wider text-slate-500">Production (W)</label>
									<EntityPicker
										bind:value={solarProductionEntity}
										deviceClass="power"
										placeholder="sensor.enphase_current_power_production"
									/>
								</div>
								<div class="space-y-1">
									<label class="block text-[11px] uppercase tracking-wider text-slate-500">Today's Production (Wh/kWh)</label>
									<EntityPicker
										bind:value={solarTodayEntity}
										deviceClass="energy"
										placeholder="sensor.enphase_today_s_energy_production"
									/>
								</div>
								<div class="space-y-1">
									<label class="block text-[11px] uppercase tracking-wider text-slate-500">Lifetime Production (kWh)</label>
									<EntityPicker
										bind:value={solarLifetimeEntity}
										deviceClass="energy"
										placeholder="Optional — lifetime total"
									/>
								</div>
								<div class="grid grid-cols-2 gap-2">
									<div class="space-y-1">
										<label class="block text-[11px] uppercase tracking-wider text-slate-500">Grid Import (W)</label>
										<EntityPicker
											bind:value={solarGridImportEntity}
											deviceClass="power"
											placeholder="Optional"
										/>
									</div>
									<div class="space-y-1">
										<label class="block text-[11px] uppercase tracking-wider text-slate-500">Grid Export (W)</label>
										<EntityPicker
											bind:value={solarGridExportEntity}
											deviceClass="power"
											placeholder="Optional"
										/>
									</div>
								</div>
								<div class="space-y-1">
									<label class="block text-[11px] uppercase tracking-wider text-slate-500">Utility Rate ($/kWh)</label>
									<input
										type="number"
										step="0.001"
										min="0"
										bind:value={solarUtilityRate}
										class="w-24 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-yellow-500/50"
										style="font-variant-numeric: tabular-nums"
									/>
								</div>
							</div>
							<div class="flex flex-wrap gap-2">
								<button
									onclick={() => void saveSolarSettings()}
									disabled={solarSaving}
									class="rounded-lg bg-yellow-600 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-yellow-500 disabled:opacity-50 active:scale-[0.96]"
								>
									{solarSaving ? 'Saving…' : 'Save'}
								</button>
							</div>
							{#if solarUpdatedAt}
								<p class="text-xs text-slate-500">Last saved: {new Date(solarUpdatedAt).toLocaleString()}</p>
							{/if}
						</div>
					</div>
					{/if}
				{/if}
			</div>
		{/each}

		{#if showCreateHome}
			<div class="rounded-xl border border-indigo-600/40 bg-slate-800/50 p-4 space-y-3">
				<div>
					<label class="text-xs text-slate-400 block mb-1">Name</label>
					<input type="text" bind:value={newHomeName} placeholder="e.g. Beach House" class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-border-color" onkeydown={(e) => { if (e.key === 'Enter' && newHomeName.trim()) createHome(); }} />
				</div>
				<div class="grid grid-cols-3 gap-2">
					<div class="col-span-3 sm:col-span-1">
						<label class="text-xs text-slate-400 block mb-1">Address (optional)</label>
						<input type="text" bind:value={newHomeAddress} class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-border-color" />
					</div>
					<div>
						<label class="text-xs text-slate-400 block mb-1">City</label>
						<input type="text" bind:value={newHomeCity} class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-border-color" />
					</div>
					<div>
						<label class="text-xs text-slate-400 block mb-1">State</label>
						<input type="text" bind:value={newHomeState} class="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-border-color" />
					</div>
				</div>
				<div class="flex gap-2">
					<button onclick={() => { showCreateHome = false; }} class="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-color">Cancel</button>
					<button onclick={() => createHome()} disabled={!newHomeName.trim() || creatingHome} class="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50 transition-background-color">{creatingHome ? 'Creating…' : 'Create Home'}</button>
				</div>
			</div>
		{:else}
			<button onclick={() => { showCreateHome = true; }} class="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-600 text-sm text-slate-400 hover:text-white hover:border-slate-400 transition-colors">
				<Icon icon="mdi:plus" width={18} />
				Add Home
			</button>
		{/if}
	</section>
	{/if}

	<!-- General tab placeholder -->
	{#if activeTab === 'general'}
	<header class="space-y-2">
		<h2 class="text-lg font-bold text-white">General</h2>
		<p class="text-sm text-slate-400">App-wide preferences and data management.</p>
	</header>
	<section class="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-4 space-y-3">
		<p class="text-sm text-slate-400">General settings (theme, data export, backup) will be available here in a future release.</p>
	</section>
	{/if}
</div>
