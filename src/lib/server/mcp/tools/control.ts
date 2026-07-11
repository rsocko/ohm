/**
 * B4: control_device — write tool for toggling HA devices with confirmation.
 * Uses the standard confirmation flow: execute() returns a ConfirmationPayload,
 * executeConfirmed() performs the actual service call.
 */

import type { ToolDefinition, ToolResponse, ToolResult, ToolError } from '../types';
import { generateConfirmationId } from '../types';
import * as haClient from '$lib/server/ha-client';
import { findBestMatches } from '$lib/server/fuzzy-match';

export const controlDevice: ToolDefinition = {
	name: 'control_device',
	description:
		'Turn a Home Assistant device on, off, or toggle it. Shows a confirmation before executing. ' +
		'Use when user says "turn off the kitchen lights", "toggle the fan", or "turn on the porch light".',
	category: 'write',
	parameters: {
		entity_id: {
			type: 'string',
			description: 'HA entity ID (e.g., "light.kitchen", "switch.garage_door"). Provide if known.'
		},
		device_name: {
			type: 'string',
			description: 'Friendly name to search for (e.g., "kitchen lights", "garage door"). Used when entity_id is unknown.'
		},
		action: {
			type: 'string',
			description: 'Action to perform',
			required: true,
			enum: ['turn_on', 'turn_off', 'toggle']
		}
	},
	async execute(args): Promise<ToolResponse> {
		const configured = await haClient.isConfigured();
		if (!configured) {
			return { success: false, error: 'Home Assistant integration is not configured.' };
		}

		const entityId = args.entity_id as string | undefined;
		const deviceName = args.device_name as string | undefined;
		const action = String(args.action);

		if (!['turn_on', 'turn_off', 'toggle'].includes(action)) {
			return { success: false, error: 'action must be "turn_on", "turn_off", or "toggle"' };
		}

		if (!entityId && !deviceName) {
			return { success: false, error: 'Provide either entity_id or device_name.' };
		}

		try {
			// Resolve the entity
			let targetEntity: haClient.HAEntityState | null = null;

			if (entityId) {
				targetEntity = await haClient.getEntity(entityId);
				if (!targetEntity) {
					return { success: false, error: `Entity "${entityId}" not found in Home Assistant.` };
				}
			} else {
				// Search by friendly name in controllable domains
				const controllableDomains = ['light', 'switch', 'fan', 'media_player'];
				const allEntities: haClient.HAEntityState[] = [];
				for (const domain of controllableDomains) {
					const entities = await haClient.getEntities({ domain });
					allEntities.push(...entities);
				}

				const matches = findBestMatches(
					deviceName!,
					allEntities,
					(e) => (e.attributes?.friendly_name as string) || e.entity_id,
					{ threshold: 0.2, maxResults: 5 }
				);

				if (matches.length === 0) {
					return { success: false, error: `No controllable devices found matching "${deviceName}".` };
				}

				if (matches.length > 1 && matches[0].score < 0.8) {
					return {
						success: false,
						error: `Multiple devices match "${deviceName}". Which one?\n${matches.map(m =>
							`• ${(m.item.attributes?.friendly_name as string) || m.item.entity_id} (${m.item.entity_id}) — currently ${m.item.state}`
						).join('\n')}`
					};
				}

				targetEntity = matches[0].item;
			}

			const friendlyName = (targetEntity.attributes?.friendly_name as string) || targetEntity.entity_id;
			const actionLabel = action === 'turn_on' ? 'Turn ON' : action === 'turn_off' ? 'Turn OFF' : 'Toggle';

			return {
				success: true,
				confirmation: {
					id: generateConfirmationId(),
					tool: 'control_device',
					summary: `${actionLabel} "${friendlyName}" (currently ${targetEntity.state})`,
					operations: [
						{
							action: 'update',
							table: 'HA Device',
							label: `${actionLabel}: ${friendlyName}`,
							details: {
								entityId: targetEntity.entity_id,
								currentState: targetEntity.state,
								action
							}
						}
					],
					execute: {
						tool: 'control_device',
						args: { entity_id: targetEntity.entity_id, action },
						confirmed: true
					}
				}
			};
		} catch (err) {
			return { success: false, error: `Home Assistant lookup failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
		}
	},
	async executeConfirmed(args): Promise<ToolResult | ToolError> {
		const entityId = String(args.entity_id);
		const action = String(args.action);

		// Validate action to prevent arbitrary service calls
		const validActions = ['turn_on', 'turn_off', 'toggle'] as const;
		if (!validActions.includes(action as typeof validActions[number])) {
			return { success: false, error: `Invalid action "${action}". Must be turn_on, turn_off, or toggle.` };
		}

		const result = await haClient.callService({
			entity_id: entityId,
			action: action as 'turn_on' | 'turn_off' | 'toggle'
		});

		if (!result.success) {
			return { success: false, error: result.error || `Failed to ${action} ${entityId}` };
		}

		const friendlyName = (await haClient.getEntity(entityId))?.attributes?.friendly_name || entityId;

		return {
			success: true,
			data: {
				message: `✓ ${friendlyName} is now ${result.new_state || action.replace('turn_', '')}`,
				entityId,
				newState: result.new_state
			}
		};
	}
};

/** All cross-feature write tools */
export const crossFeatureWriteTools: ToolDefinition[] = [
	controlDevice
];
