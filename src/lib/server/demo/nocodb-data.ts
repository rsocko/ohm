/**
 * Demo NocoDB data — realistic fixture records for the electrical config app.
 * Mirrors the V3 API response shapes used by nocodb.ts.
 */

import type { Table, V3Record } from '../nocodb';

export const DEMO_TABLES: Table[] = [
	{ id: 'tbl_homes', title: 'Home' },
	{ id: 'tbl_rooms', title: 'Area' },
	{ id: 'tbl_panels', title: 'Panel' },
	{ id: 'tbl_circuits', title: 'Circuit' },
	{ id: 'tbl_loads', title: 'Load' },
	{ id: 'tbl_receptacles', title: 'Receptacle' },
	{ id: 'tbl_comments', title: 'Comments' }
];

const HOMES: V3Record[] = [
	{
		id: 1,
		id_fields: { Id: 1 },
		fields: { Name: 'Willow House', Address: '12 Example Ln.', City: 'Rivertown', State: 'MA', Zip: '01000' }
	},
	{
		id: 2,
		id_fields: { Id: 2 },
		fields: { Name: 'Birchwood House', Address: '48 Sample Ave', City: 'Lakeview', State: 'MA', Zip: '02000' }
	}
];

const ROOMS: V3Record[] = [
	{ id: 1, id_fields: { Id: 1 }, fields: { Name: 'Basement Sitting Area', Floor: 'Basement', Description: '', Home: { id: 1, value: 'Willow House' } } },
	{ id: 5, id_fields: { Id: 5 }, fields: { Name: 'Kitchen', Floor: 'Main', Description: 'Central kitchen with island', Home: { id: 1, value: 'Willow House' } } },
	{ id: 7, id_fields: { Id: 7 }, fields: { Name: 'Master Bedroom', Floor: 'Main', Description: '', Home: { id: 1, value: 'Willow House' } } },
	{ id: 24, id_fields: { Id: 24 }, fields: { Name: 'Family Room', Floor: 'Main', Description: 'Open layout with patio door', Home: { id: 1, value: 'Willow House' } } },
	{ id: 26, id_fields: { Id: 26 }, fields: { Name: 'Family Room', Floor: '1st Floor', Description: '', Home: { id: 2, value: 'Birchwood House' } } },
	{ id: 28, id_fields: { Id: 28 }, fields: { Name: 'Kitchen', Floor: '1st Floor', Description: '', Home: { id: 2, value: 'Birchwood House' } } },
	{ id: 30, id_fields: { Id: 30 }, fields: { Name: 'Garage', Floor: 'Ground', Description: 'EV charger location', Home: { id: 1, value: 'Willow House' } } },
	{ id: 31, id_fields: { Id: 31 }, fields: { Name: 'Laundry Room', Floor: 'Basement', Description: '', Home: { id: 1, value: 'Willow House' } } }
];

const PANELS: V3Record[] = [
	{ id: 4, id_fields: { Id: 4 }, fields: { Name: 'Main Panel', Location: 'Basement', 'Service Size': 200, Phases: 1, Home: { id: 1, value: 'Willow House' }, Area: { id: 1, value: 'Basement Sitting Area' } } },
	{ id: 5, id_fields: { Id: 5 }, fields: { Name: 'Main Panel', Location: 'Basement', 'Service Size': 200, Phases: 1, Home: { id: 2, value: 'Birchwood House' }, Area: { id: 26, value: 'Family Room' } } }
];

const CIRCUITS: V3Record[] = [
	{ id: 1, id_fields: { Id: 1 }, fields: { Name: 'Living Room Plugs', Number: 13, Amps: 15, Description: 'Living Room Plugs', 'GFCI Protected': false, Panel: { id: 4, value: 'Main Panel' }, Room: { id: 24, value: 'Family Room' }, ha_power_entity_id: 'sensor.emporia_vue_living_room_plugs' } },
	{ id: 2, id_fields: { Id: 2 }, fields: { Name: 'Counter Plugs', Number: 1, Amps: 20, Description: 'Counter Plugs', 'GFCI Protected': false, Panel: { id: 4, value: 'Main Panel' }, Room: { id: 5, value: 'Kitchen' }, ha_power_entity_id: 'sensor.emporia_vue_counter_plugs' } },
	{ id: 3, id_fields: { Id: 3 }, fields: { Name: 'Living Room Lights', Number: 11, Amps: 15, Description: 'Living Room Lights', 'GFCI Protected': false, Panel: { id: 4, value: 'Main Panel' }, Room: { id: 24, value: 'Family Room' }, ha_power_entity_id: 'sensor.emporia_vue_living_room_lights' } },
	{ id: 5, id_fields: { Id: 5 }, fields: { Name: '1st Floor Bathroom Plug', Number: 3, Amps: 20, Description: '1st Floor Bathroom Plug', 'GFCI Protected': true, Panel: { id: 4, value: 'Main Panel' }, Room: null } },
	{ id: 6, id_fields: { Id: 6 }, fields: { Name: 'Air Conditioner', Number: 28, Amps: 30, Description: 'Air Conditioner', 'GFCI Protected': false, Panel: { id: 4, value: 'Main Panel' }, Room: null, ha_power_entity_id: 'sensor.emporia_vue_air_conditioner' } },
	{ id: 11, id_fields: { Id: 11 }, fields: { Name: 'Kitchen Recessed Lights', Number: 7, Amps: 20, Description: 'Kitchen Recessed Lights, Living Room', 'GFCI Protected': false, Panel: { id: 4, value: 'Main Panel' }, Room: { id: 5, value: 'Kitchen' }, ha_power_entity_id: 'sensor.emporia_vue_kitchen_recessed' } },
	{ id: 12, id_fields: { Id: 12 }, fields: { Name: 'Master Bedroom Plugs', Number: 15, Amps: 20, Description: 'Master Bedroom Plugs', 'GFCI Protected': false, Panel: { id: 4, value: 'Main Panel' }, Room: { id: 7, value: 'Master Bedroom' }, ha_power_entity_id: 'sensor.emporia_vue_master_bedroom' } },
	{ id: 13, id_fields: { Id: 13 }, fields: { Name: 'EV Charger', Number: 30, Amps: 50, Description: 'EV Charger', 'GFCI Protected': true, Panel: { id: 4, value: 'Main Panel' }, Room: { id: 30, value: 'Garage' }, ha_power_entity_id: 'sensor.emporia_vue_ev_charger' } },
	{ id: 14, id_fields: { Id: 14 }, fields: { Name: 'Washer', Number: 5, Amps: 20, Description: 'Washer', 'GFCI Protected': false, Panel: { id: 4, value: 'Main Panel' }, Room: { id: 31, value: 'Laundry Room' }, ha_power_entity_id: 'sensor.emporia_vue_washer' } },
	{ id: 15, id_fields: { Id: 15 }, fields: { Name: 'Dryer', Number: 9, Amps: 30, Description: 'Dryer', 'GFCI Protected': false, Panel: { id: 4, value: 'Main Panel' }, Room: { id: 31, value: 'Laundry Room' }, ha_power_entity_id: 'sensor.emporia_vue_dryer' } }
];

const LOADS: V3Record[] = [
	{ id: 22, id_fields: { Id: 22 }, fields: { Name: 'Kitchen - Phone / Wires by island', 'Device Type': 'Electronics', Wattage: null, 'Fixture Count': null, Area: { id: 5, value: 'Kitchen' }, Circuit: null } },
	{ id: 28, id_fields: { Id: 28 }, fields: { Name: 'Kitchen - Mid-Kitchen ceiling that is covered now', 'Device Type': 'Light - Ceiling', Wattage: null, 'Fixture Count': null, Area: { id: 5, value: 'Kitchen' }, Circuit: { id: 11, value: '7' } } },
	{ id: 62, id_fields: { Id: 62 }, fields: { Name: 'Kitchen - Ceiling by back door', 'Device Type': 'Light - Ceiling', Wattage: 60, 'Fixture Count': 1, Area: { id: 5, value: 'Kitchen' }, Circuit: { id: 11, value: '7' } } },
	{ id: 68, id_fields: { Id: 68 }, fields: { Name: 'Kitchen - Corner Ceiling (3 lights)', 'Device Type': 'Light - Ceiling', Wattage: 36, 'Fixture Count': 3, Area: { id: 5, value: 'Kitchen' }, Circuit: { id: 11, value: '7' } } },
	{ id: 85, id_fields: { Id: 85 }, fields: { Name: 'Kitchen - Ceiling (Above Island - 3 lights)', 'Device Type': 'Light - Ceiling', Wattage: 36, 'Fixture Count': 3, Area: { id: 5, value: 'Kitchen' }, Circuit: { id: 11, value: '7' } } },
	{ id: 1, id_fields: { Id: 1 }, fields: { Name: 'Master Bedroom - Thermostat Box', 'Device Type': 'HVAC', Wattage: 5, 'Fixture Count': null, Area: { id: 7, value: 'Master Bedroom' }, Circuit: null } },
	{ id: 103, id_fields: { Id: 103 }, fields: { Name: 'Patio - Camera/Light above door', 'Device Type': 'Security Camera', Wattage: 15, 'Fixture Count': 1, Area: { id: 24, value: 'Family Room' }, Circuit: { id: 1, value: '13' } } }
];

const RECEPTACLES: V3Record[] = [
	{ id: 1, id_fields: { Id: 1 }, fields: { Name: 'FAM-SW-Right side of Patio Door (4-Gang Left-Middle)', Type: 'On/Off Relay', 'Gang Position': 2, 'Loc Direction': 'S - South', 'Loc Placement': 'W - Wall', Area: { id: 24, value: 'Family Room' }, Circuit: { id: 11, value: '7' } } },
	{ id: 2, id_fields: { Id: 2 }, fields: { Name: 'KIT-SW-Behind Microwave (3-Gang-Left)', Type: 'On/Off Switch', 'Gang Position': null, 'Loc Direction': 'E - East', 'Loc Placement': null, Area: { id: 5, value: 'Kitchen' }, Circuit: null } },
	{ id: 46, id_fields: { Id: 46 }, fields: { Name: 'KIT-SW-Entrance of Pantry (Left)', Type: 'On/Off Switch', 'Gang Position': null, 'Loc Direction': 'S - South', 'Loc Placement': null, Area: { id: 5, value: 'Kitchen' }, Circuit: { id: 11, value: '7' } } },
	{ id: 68, id_fields: { Id: 68 }, fields: { Name: 'KIT-SW-Over Island (2-Gang-Right)', Type: 'Dimmer Switch', 'Gang Position': null, 'Loc Direction': 'N - North', 'Loc Placement': null, Area: { id: 5, value: 'Kitchen' }, Circuit: { id: 11, value: '7' } } },
	{ id: 73, id_fields: { Id: 73 }, fields: { Name: 'KIT-GFCI-Right of Stove (2-Gang-Right)', Type: 'GFCI Outlet', 'Gang Position': null, 'Loc Direction': 'S - South', 'Loc Placement': null, Area: { id: 5, value: 'Kitchen' }, Circuit: null } }
];

const COMMENTS: V3Record[] = [
	{ id: 1, id_fields: { Id: 1 }, fields: { Text: 'Need to verify breaker 28 trip threshold', 'Table Name': 'Circuits', 'Record Id': 6, CreatedAt: '2026-07-01T14:30:00Z' } },
	{ id: 2, id_fields: { Id: 2 }, fields: { Text: 'Island lights flicker when microwave runs — may be shared neutral', 'Table Name': 'Loads', 'Record Id': 85, CreatedAt: '2026-07-05T09:15:00Z' } }
];

const TABLE_DATA: Record<string, V3Record[]> = {
	tbl_homes: HOMES,
	tbl_rooms: ROOMS,
	tbl_panels: PANELS,
	tbl_circuits: CIRCUITS,
	tbl_loads: LOADS,
	tbl_receptacles: RECEPTACLES,
	tbl_comments: COMMENTS
};

export function getDemoTables(): Table[] {
	return DEMO_TABLES;
}

export function getDemoRecords(tableId: string, params?: Record<string, string>): V3Record[] {
	const records = TABLE_DATA[tableId] || [];

	// Support basic filtering by where param (simplified)
	if (params?.where) {
		const match = params.where.match(/\(([^,]+),eq,([^)]+)\)/);
		if (match) {
			const [, field, value] = match;
			return records.filter((r) => {
				const fieldValue = r.fields[field];
				if (fieldValue && typeof fieldValue === 'object' && 'id' in fieldValue) {
					return String((fieldValue as { id: number }).id) === value;
				}
				return String(fieldValue) === value;
			});
		}
	}

	// Support pageSize
	if (params?.pageSize) {
		return records.slice(0, parseInt(params.pageSize));
	}

	return records;
}

export function getDemoRecordById(tableId: string, recordId: number): V3Record | null {
	const records = TABLE_DATA[tableId] || [];
	return records.find((r) => r.id === recordId) || null;
}

export function getDemoTableMeta(tableId: string): Record<string, unknown> {
	const table = DEMO_TABLES.find((t) => t.id === tableId);
	return {
		id: tableId,
		title: table?.title || 'Unknown',
		columns: [
			{ id: 'col_id', title: 'Id', uidt: 'ID' },
			{ id: 'col_name', title: 'Name', uidt: 'SingleLineText' }
		]
	};
}
