/**
 * Domain vocabulary — aliases, synonyms, and terminology hints.
 * 
 * Used by:
 * - AI system prompt (teaches the LLM which words map to which entities)
 * - MCP tools (normalize user input before querying)
 * - Fuzzy search (boost matches for synonyms)
 * - Voice parsing (resolve spoken variations)
 */

/** Canonical entity name → common synonyms/aliases users might say */
export const entityAliases: Record<string, string[]> = {
	// Table-level aliases
	Home: ['house', 'property', 'residence', 'place'],
	Area: ['room', 'space', 'zone', 'location'],
	Panel: ['breaker box', 'panel box', 'electrical panel', 'breaker panel', 'load center', 'distribution panel'],
	Circuit: ['breaker', 'circuit breaker'],
	Receptacle: ['outlet', 'plug', 'socket', 'switch', 'junction', 'box', 'wall plate'],
	Load: ['device', 'fixture', 'appliance', 'light', 'fan', 'equipment'],
};

/** Field-level aliases (canonical NocoDB field → spoken/typed variations) */
export const fieldAliases: Record<string, string[]> = {
	'Name': ['name', 'title', 'label', 'called'],
	'Floor': ['floor', 'level', 'story', 'storey'],
	'Number': ['number', 'breaker number', 'circuit number', '#'],
	'Amps': ['amps', 'amperage', 'amp rating', 'amperes', 'amp'],
	'Wattage': ['watts', 'wattage', 'power', 'draw'],
	'Device Type': ['type', 'device type', 'kind', 'category'],
	'Fixture_Count': ['count', 'quantity', 'how many', 'number of'],
	'GFCI Protected': ['gfci', 'ground fault', 'gfi', 'gfci protected'],
	'Receptacle Type': ['outlet type', 'switch type', 'plug type', 'receptacle type'],
	'Loc.Direction': ['direction', 'wall', 'side', 'facing'],
	'Loc.Placement': ['placement', 'height', 'position', 'where on wall'],
	'Service Size': ['service', 'service size', 'main breaker', 'total amps'],
	'Gang Position': ['gang', 'gang position', 'slot', 'position in box'],
};

/** Device type inference — spoken phrase → canonical Device Type value */
export const deviceTypeInference: Record<string, string> = {
	'light': 'Light',
	'lights': 'Light',
	'recessed': 'Light',
	'recessed can': 'Light',
	'recessed cans': 'Light',
	'can light': 'Light',
	'chandelier': 'Light',
	'pendant': 'Light',
	'sconce': 'Light',
	'track light': 'Light',
	'under cabinet': 'Light',
	'led strip': 'Light',
	'ceiling fan': 'Fan',
	'fan': 'Fan',
	'exhaust fan': 'Fan',
	'bath fan': 'Fan',
	'bathroom fan': 'Fan',
	'range hood': 'Fan',
	'tv': 'Appliance',
	'television': 'Appliance',
	'refrigerator': 'Appliance',
	'fridge': 'Appliance',
	'freezer': 'Appliance',
	'microwave': 'Appliance',
	'dishwasher': 'Appliance',
	'washer': 'Appliance',
	'dryer': 'Appliance',
	'oven': 'Appliance',
	'range': 'Appliance',
	'stove': 'Appliance',
	'garbage disposal': 'Appliance',
	'disposal': 'Appliance',
	'water heater': 'Appliance',
	'hot tub': 'Appliance',
	'pool pump': 'Motor',
	'sump pump': 'Motor',
	'well pump': 'Motor',
	'garage door': 'Motor',
	'ac': 'HVAC',
	'air conditioner': 'HVAC',
	'heat pump': 'HVAC',
	'furnace': 'HVAC',
	'mini split': 'HVAC',
	'thermostat': 'HVAC',
	'smoke detector': 'Safety',
	'carbon monoxide': 'Safety',
	'co detector': 'Safety',
	'doorbell': 'Low Voltage',
	'camera': 'Low Voltage',
	'access point': 'Low Voltage',
	'network switch': 'Low Voltage',
	'ev charger': 'EV',
	'car charger': 'EV',
	'tesla charger': 'EV',
	'level 2 charger': 'EV',
};

/** Receptacle type inference — spoken phrase → canonical Receptacle Type value */
export const receptacleTypeInference: Record<string, string> = {
	'outlet': 'Outlet',
	'plug': 'Outlet',
	'duplex': 'Duplex Outlet',
	'duplex outlet': 'Duplex Outlet',
	'gfci': 'GFCI Outlet',
	'gfi': 'GFCI Outlet',
	'gfci outlet': 'GFCI Outlet',
	'switch': 'Switch',
	'light switch': 'Switch',
	'toggle': 'Switch',
	'dimmer': 'Dimmer Switch',
	'dimmer switch': 'Dimmer Switch',
	'3-way': '3-Way Switch',
	'3-way switch': '3-Way Switch',
	'three way': '3-Way Switch',
	'three way switch': '3-Way Switch',
	'3 way': '3-Way Switch',
	'3 way switch': '3-Way Switch',
	'4-way': '4-Way Switch',
	'4-way switch': '4-Way Switch',
	'four way': '4-Way Switch',
	'four way switch': '4-Way Switch',
	'usb outlet': 'USB Outlet',
	'usb': 'USB Outlet',
	'240': '240V Outlet',
	'240v': '240V Outlet',
	'dryer outlet': '240V Outlet',
	'range outlet': '240V Outlet',
	'blank': 'Blank Plate',
	'blank plate': 'Blank Plate',
	'junction': 'Junction Box',
	'junction box': 'Junction Box',
	'smart switch': 'Smart Switch',
	'smart dimmer': 'Smart Dimmer',
};

/** Direction aliases — spoken phrase → canonical Loc.Direction value */
export const directionAliases: Record<string, string> = {
	'north': 'N', 'north wall': 'N',
	'south': 'S', 'south wall': 'S',
	'east': 'E', 'east wall': 'E',
	'west': 'W', 'west wall': 'W',
	'northeast': 'NE', 'ne': 'NE',
	'northwest': 'NW', 'nw': 'NW',
	'southeast': 'SE', 'se': 'SE',
	'southwest': 'SW', 'sw': 'SW',
	'ceiling': 'Ceiling',
	'floor': 'Floor',
	'exterior': 'Exterior',
	'outside': 'Exterior',
};

/**
 * Resolve an entity alias to its canonical table name.
 * Returns the canonical name if found, otherwise the input unchanged.
 */
export function resolveEntityAlias(input: string): string {
	const lower = input.toLowerCase().trim();
	for (const [canonical, aliases] of Object.entries(entityAliases)) {
		if (canonical.toLowerCase() === lower) return canonical;
		if (aliases.some(a => a === lower)) return canonical;
	}
	return input;
}

/**
 * Infer a Device Type from a spoken/typed description.
 * Returns the canonical type or undefined if no match.
 */
export function inferDeviceType(description: string): string | undefined {
	const lower = description.toLowerCase().trim();
	// Try exact match first
	if (deviceTypeInference[lower]) return deviceTypeInference[lower];
	// Try word-boundary match (longer phrases first)
	const sorted = Object.entries(deviceTypeInference).sort((a, b) => b[0].length - a[0].length);
	for (const [phrase, type] of sorted) {
		if (matchesAsWord(lower, phrase)) return type;
	}
	return undefined;
}

/**
 * Infer a Receptacle Type from a spoken/typed description.
 */
export function inferReceptacleType(description: string): string | undefined {
	const lower = description.toLowerCase().trim();
	if (receptacleTypeInference[lower]) return receptacleTypeInference[lower];
	const sorted = Object.entries(receptacleTypeInference).sort((a, b) => b[0].length - a[0].length);
	for (const [phrase, type] of sorted) {
		if (matchesAsWord(lower, phrase)) return type;
	}
	return undefined;
}

/**
 * Resolve a direction alias to canonical form.
 */
export function resolveDirection(input: string): string {
	const lower = input.toLowerCase().trim();
	return directionAliases[lower] || input;
}

/**
 * Given a description of something to create (e.g. "dimmer", "ceiling fan", "outlet"),
 * infer which TABLE it belongs to and what type value to use.
 * 
 * This is the key disambiguation function — it resolves ambiguity when
 * a user doesn't explicitly say "load" or "receptacle".
 * 
 * Returns: { table, type, confidence } or null if can't determine.
 */
export function inferEntityFromDescription(description: string): {
	table: 'Load' | 'Receptacle';
	typeName: string;
	typeValue: string;
	confidence: 'high' | 'medium';
} | null {
	const lower = description.toLowerCase().trim();

	// Sort entries by phrase length descending so "3-way switch" matches before "switch"
	const sortedReceptacle = Object.entries(receptacleTypeInference)
		.sort((a, b) => b[0].length - a[0].length);
	const sortedDevice = Object.entries(deviceTypeInference)
		.sort((a, b) => b[0].length - a[0].length);

	// Check receptacle types first (switches, outlets, dimmers are always Receptacles)
	for (const [phrase, type] of sortedReceptacle) {
		if (lower === phrase || matchesAsWord(lower, phrase)) {
			return { table: 'Receptacle', typeName: 'Receptacle Type', typeValue: type, confidence: 'high' };
		}
	}

	// Check device/load types (lights, fans, appliances are always Loads)
	for (const [phrase, type] of sortedDevice) {
		if (lower === phrase || matchesAsWord(lower, phrase)) {
			return { table: 'Load', typeName: 'Device Type', typeValue: type, confidence: 'high' };
		}
	}

	return null;
}

/** Check if phrase appears in text as a word (not as a substring of another word) */
function matchesAsWord(text: string, phrase: string): boolean {
	const idx = text.indexOf(phrase);
	if (idx === -1) return false;
	// Allow hyphens and digits as part of the match (e.g., "3-way")
	const before = idx === 0 || /[\s,;.!?]/.test(text[idx - 1]);
	const after = idx + phrase.length >= text.length || /[\s,;.!?]/.test(text[idx + phrase.length]);
	return before && after;
}

/**
 * Generate a vocabulary summary for inclusion in AI system prompts.
 * This teaches the LLM the domain terminology and disambiguation rules.
 */
export function getVocabularySummary(): string {
	return `Domain vocabulary (users may say any of these interchangeably):
- "room" / "space" / "area" / "zone" → Area table
- "house" / "home" / "property" / "place" → Home table  
- "breaker" / "circuit breaker" / "breaker box" → Circuit or Panel
- "outlet" / "plug" / "socket" / "switch" / "box" → Receptacle table
- "device" / "fixture" / "appliance" / "light" → Load table
- "panel" / "breaker box" / "load center" → Panel table

Entity disambiguation (when user doesn't say "load" or "receptacle" explicitly):
- Switches, dimmers, outlets, GFCI, USB outlets, blank plates → ALWAYS a Receptacle
- Lights, fans, appliances, motors, HVAC, EV chargers → ALWAYS a Load
- "Add a dimmer to the kitchen" → create Receptacle (type: Dimmer Switch) in kitchen
- "Add recessed cans to the bedroom" → create Load (type: Light) in bedroom
- "Add an outlet by the TV" → create Receptacle (type: Outlet)
- "Add a ceiling fan" → create Load (type: Fan)

If truly ambiguous (e.g., "add something to circuit 3"), ask which type.

When users mention these terms, map to the correct table/entity automatically.`;
}
