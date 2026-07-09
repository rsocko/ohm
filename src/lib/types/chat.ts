export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageContentType =
	| 'text'
	| 'action-confirmation'
	| 'batch-confirmation'
	| 'data-card'
	| 'error';

export interface DeepLink {
	label: string;
	route: string;
}

export interface DataCardField {
	label: string;
	value: string;
	type?: 'default' | 'mono' | 'badge-gfci' | 'badge-afci' | 'badge-standard' | 'badge-warning';
}

export interface DataCardContent {
	title?: string;
	fields: DataCardField[];
	footer?: string;
}

export interface ActionChange {
	recordId: string;
	label: string;
	field: string;
	oldValue: string;
	newValue: string;
}

export interface ActionConfirmationContent {
	description: string;
	changes: ActionChange[];
	table: string;
}

export interface BatchOperation {
	action: 'create' | 'update' | 'link' | 'unlink';
	table: string;
	label: string;
	fields?: Record<string, unknown>;
	recordId?: string;
	tempId?: string;
	linkField?: string;
	linkTarget?: { table: string; recordId: string };
}

export interface BatchConfirmationContent {
	summary: string;
	operations: BatchOperation[];
}

export interface ChatMessage {
	id: string;
	role: MessageRole;
	content: string;
	contentType: MessageContentType;
	timestamp: number;
	dataCard?: DataCardContent;
	deepLinks?: DeepLink[];
	actionConfirmation?: ActionConfirmationContent;
	batchConfirmation?: BatchConfirmationContent;
}

export interface ChatContext {
	currentRoute: string;
	selectedPanel?: string;
	selectedCircuit?: string;
	selectedRoom?: string;
}
