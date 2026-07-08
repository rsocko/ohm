/**
 * Returns the best display name for a NocoDB record.
 * Prefers "Display Name" field (short, contextual), falls back to "Name".
 * For receptacles also checks "Receptacle Name" as a legacy fallback.
 */
export function getDisplayName(
	record: { fields: Record<string, unknown> },
	fallback = 'Unnamed'
): string {
	const displayName = record.fields['Display Name'] as string | undefined;
	if (displayName) return displayName;
	const name = record.fields.Name as string | undefined;
	if (name) return name;
	const recName = record.fields['Receptacle Name'] as string | undefined;
	if (recName) return recName;
	return fallback;
}

/**
 * Returns the full canonical name (always from Name field).
 * Use for search indexing, confirm dialogs, and contexts needing the complete identifier.
 */
export function getFullName(
	record: { fields: Record<string, unknown> },
	fallback = 'Unnamed'
): string {
	return (record.fields.Name as string) || (record.fields['Receptacle Name'] as string) || fallback;
}
