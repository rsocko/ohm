/**
 * PDF/PNG Label Export — fallback for browsers without Web Bluetooth
 */

import type { RenderedLabel } from './types';

/** Download a single label as PNG */
export function downloadLabelAsPng(label: RenderedLabel, filename: string = 'label.png'): void {
	const dataUrl = label.canvas.toDataURL('image/png');
	const link = document.createElement('a');
	link.download = filename;
	link.href = dataUrl;
	link.click();
}

interface DirectoryCircuit {
	number: number;
	name: string;
	amps: number;
	gfci?: boolean;
	afci?: boolean;
	poles?: number;
	monitored?: boolean;
}

interface DirectoryReceptacle {
	name: string;
	area: string;
	type: string;
	circuitNumber: number;
}

interface DirectoryData {
	panelName: string;
	location?: string;
	capacity?: number;
	serviceSize?: string;
	generatorBacked?: boolean;
	circuits: DirectoryCircuit[];
	receptacles?: DirectoryReceptacle[];
	catalogWidthMm?: number;
	catalogHeightMm?: number;
}

/** Print a panel directory as a letter-size PDF via system dialog */
export function printPanelDirectoryPdf(data: DirectoryData): void {
	const { panelName, location, capacity, serviceSize, generatorBacked, circuits, receptacles } = data;
	const sorted = [...circuits].sort((a, b) => a.number - b.number);
	const maxSlot = Math.max(...sorted.map(c => c.number), 0);
	const totalRows = Math.ceil(maxSlot / 2);

	const circuitBySlot = new Map<number, DirectoryCircuit>();
	for (const c of sorted) circuitBySlot.set(c.number, c);

	// Detect 2-pole circuits
	const twoPoleSlots = new Set<number>();
	const twoPoleSecondary = new Set<number>();
	for (const c of sorted) {
		if (c.poles && c.poles > 1) {
			twoPoleSlots.add(c.number);
			twoPoleSecondary.add(c.number + 2);
		}
	}

	// Count occupied slots
	let slotsUsed = 0;
	for (const c of sorted) slotsUsed += (c.poles || 1);

	// Build receptacle summary per circuit number: "Room 🔌3 🔲2 | Room2 🔌1"
	const recSummaryBySlot = new Map<number, string>();
	if (receptacles && receptacles.length > 0) {
		const recsByNum = new Map<number, DirectoryReceptacle[]>();
		for (const r of receptacles) {
			const arr = recsByNum.get(r.circuitNumber) || [];
			arr.push(r);
			recsByNum.set(r.circuitNumber, arr);
		}
		for (const [num, recs] of recsByNum) {
			// Group by area, then count by type
			const byArea = new Map<string, Map<string, number>>();
			for (const r of recs) {
				const area = r.area || 'Other';
				if (!byArea.has(area)) byArea.set(area, new Map());
				const typeMap = byArea.get(area)!;
				const t = r.type || 'outlet';
				typeMap.set(t, (typeMap.get(t) || 0) + 1);
			}
			const parts: string[] = [];
			for (const [area, types] of byArea) {
				const typeParts: string[] = [];
				for (const [type, count] of types) {
					typeParts.push(`${getRecTypeIcon(type)}${count}`);
				}
				parts.push(`${escapeHtml(area)} ${typeParts.join(' ')}`);
			}
			recSummaryBySlot.set(num, parts.join(' | '));
		}
	}

	let tableRows = '';
	for (let row = 0; row < totalRows; row++) {
		const oddSlot = row * 2 + 1;
		const evenSlot = row * 2 + 2;
		const left = circuitBySlot.get(oddSlot);
		const right = circuitBySlot.get(evenSlot);

		const leftIs2P = twoPoleSlots.has(oddSlot);
		const leftIsSecondary = twoPoleSecondary.has(oddSlot);
		const rightIs2P = twoPoleSlots.has(evenSlot);
		const rightIsSecondary = twoPoleSecondary.has(evenSlot);

		// Left side cells
		let leftNameCell: string;
		let leftAmpsCell: string;
		if (leftIsSecondary) {
			leftNameCell = `<td class="name secondary">↑</td>`;
			leftAmpsCell = `<td class="amps"></td>`;
		} else if (left) {
			const badges = getBadges(left) + (left.monitored ? '<span class="badge monitored">⚡</span>' : '');
			const rowspan = leftIs2P ? ' rowspan="2"' : '';
			const cls = leftIs2P ? ' class="name twopole"' : ' class="name"';
			const recSum = recSummaryBySlot.get(oddSlot);
			const recLine = recSum ? `<br><span class="rec-summary">${recSum}</span>` : '';
			leftNameCell = `<td${cls}${rowspan}>${escapeHtml(left.name || 'Unnamed')} ${badges}${recLine}</td>`;
			leftAmpsCell = `<td class="amps"${rowspan}>${left.amps}A</td>`;
		} else {
			leftNameCell = `<td class="name"></td>`;
			leftAmpsCell = `<td class="amps"></td>`;
		}

		// Right side cells
		let rightNameCell: string;
		let rightAmpsCell: string;
		if (rightIsSecondary) {
			rightNameCell = `<td class="name r secondary">↑</td>`;
			rightAmpsCell = `<td class="amps r"></td>`;
		} else if (right) {
			const badges = getBadges(right) + (right.monitored ? '<span class="badge monitored">⚡</span>' : '');
			const rowspan = rightIs2P ? ' rowspan="2"' : '';
			const cls = rightIs2P ? ' class="name r twopole"' : ' class="name r"';
			const recSum = recSummaryBySlot.get(evenSlot);
			const recLine = recSum ? `<br><span class="rec-summary">${recSum}</span>` : '';
			rightNameCell = `<td${cls}${rowspan}>${escapeHtml(right.name || 'Unnamed')} ${badges}${recLine}</td>`;
			rightAmpsCell = `<td class="amps r"${rowspan}>${right.amps}A</td>`;
		} else {
			rightNameCell = `<td class="name r"></td>`;
			rightAmpsCell = `<td class="amps r"></td>`;
		}

		// Skip merged cells for secondary rows
		const skipLeftMerged = leftIsSecondary;
		const skipRightMerged = rightIsSecondary;

		tableRows += `<tr>
			<td class="num">${oddSlot}</td>
			${skipLeftMerged ? '' : leftNameCell}
			${skipLeftMerged ? '' : leftAmpsCell}
			<td class="divider"></td>
			${skipRightMerged ? '' : rightAmpsCell}
			${skipRightMerged ? '' : rightNameCell}
			<td class="num">${evenSlot}</td>
		</tr>`;
	}

	// Receptacles section
	let receptaclesHtml = '';
	if (receptacles && receptacles.length > 0) {
		const recsByCircuit = new Map<number, DirectoryReceptacle[]>();
		for (const r of receptacles) {
			const arr = recsByCircuit.get(r.circuitNumber) || [];
			arr.push(r);
			recsByCircuit.set(r.circuitNumber, arr);
		}
		receptaclesHtml = '<div class="receptacles-section"><h3>Receptacles by Circuit</h3>';
		for (const c of sorted) {
			const recs = recsByCircuit.get(c.number);
			if (!recs || recs.length === 0) continue;
			receptaclesHtml += `<p class="rec-circuit"><strong>${c.number} · ${escapeHtml(c.name)}</strong></p>`;
			for (const r of recs) {
				const area = r.area ? `<span class="rec-area-label">${escapeHtml(r.area)}</span> ` : '';
				receptaclesHtml += `<p class="rec-item">${area}${escapeHtml(r.name)}</p>`;
			}
		}
		receptaclesHtml += '</div>';
	}

	const slotsLabel = capacity ? `${slotsUsed}/${capacity} slots · ${Math.max(0, capacity - slotsUsed)} free` : `${slotsUsed} slots`;
	const serviceSizeLabel = serviceSize ? `${serviceSize}A` : '';
	const subtitle = [serviceSizeLabel, `${sorted.length} circuits`, slotsLabel, location].filter(Boolean).join(' · ');
	const date = new Date().toLocaleDateString();
	const generatorBanner = generatorBacked ? '<p class="generator-badge">⚡ GENERATOR BACKED ⚡</p>' : '';

	const pageSize = data.catalogWidthMm && data.catalogHeightMm
		? `${data.catalogWidthMm}mm ${data.catalogHeightMm}mm`
		: data.catalogWidthMm
			? `${data.catalogWidthMm}mm auto`
			: 'letter';

	const html = `<!DOCTYPE html>
<html>
<head>
<title>${panelName} Directory</title>
<style>
@page { size: ${pageSize}; margin: ${pageSize === 'letter' ? '0.75in' : '5mm'}; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 0; color: #1a1a1a; }
h1 { font-size: 22px; margin: 0 0 4px; text-align: center; }
.subtitle { font-size: 12px; color: #555; text-align: center; margin-bottom: 4px; }
.generator-badge { font-size: 11px; color: #92400e; text-align: center; margin: 0 0 12px; font-weight: 700; background: #fef3c7; padding: 3px 8px; border-radius: 4px; display: inline-block; margin-left: auto; margin-right: auto; width: auto; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th { background: #f0f0f0; padding: 6px 8px; font-weight: 600; text-align: left; border: 1px solid #ccc; }
td { padding: 5px 8px; border: 1px solid #ddd; vertical-align: middle; }
tr:nth-child(even) { background: #fafafa; }
.num { width: 28px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
.name { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.name.r { text-align: right; }
.rec-summary { font-size: 8px; color: #666; white-space: nowrap; }
.name.twopole { background: #f8f4ff; }
.name.secondary { color: #999; font-size: 9px; }
.amps { width: 36px; font-weight: 600; font-variant-numeric: tabular-nums; text-align: center; }
.amps.r { text-align: center; }
.divider { width: 4px; background: #333; padding: 0; border: 1px solid #333; }
.badge { font-size: 9px; padding: 1px 4px; border-radius: 3px; font-weight: 600; margin-left: 4px; }
.gfci { background: #dcfce7; color: #166534; }
.afci { background: #dbeafe; color: #1e40af; }
.v240 { background: #fef3c7; color: #92400e; }
.monitored { background: #fff7ed; color: #9a3412; }
.receptacles-section { margin-top: 16px; font-size: 8px; page-break-before: always; }
.receptacles-section h3 { font-size: 10px; margin: 0 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
.rec-circuit { margin: 6px 0 1px; font-size: 9px; }
.rec-item { margin: 0; padding-left: 12px; line-height: 1.4; color: #444; }
.rec-area-label { color: #888; font-style: italic; }
.footer { margin-top: 12px; font-size: 10px; color: #888; text-align: center; }
</style>
</head>
<body>
<h1>${escapeHtml(panelName)}</h1>
<p class="subtitle">${escapeHtml(subtitle)}</p>
${generatorBanner}
<table>
<thead>
<tr><th class="num">#</th><th>Circuit (Odd/Left)</th><th>A</th><th class="divider"></th><th>A</th><th style="text-align:right">Circuit (Even/Right)</th><th class="num">#</th></tr>
</thead>
<tbody>${tableRows}</tbody>
</table>
${receptaclesHtml}
<p class="footer">Generated ${date}</p>
</body>
</html>`;

	const printWindow = window.open('', '_blank', 'width=800,height=1000');
	if (!printWindow) return;
	printWindow.document.write(html);
	printWindow.document.close();
	printWindow.onload = () => {
		setTimeout(() => { printWindow.print(); printWindow.close(); }, 300);
	};
}

function escapeHtml(str: string | unknown): string {
	const s = String(str ?? '');
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getBadges(c: DirectoryCircuit): string {
	let badges = '';
	if (c.gfci) badges += '<span class="badge gfci">GFCI</span>';
	if (c.afci) badges += '<span class="badge afci">AFCI</span>';
	if (c.poles && c.poles > 1) badges += '<span class="badge v240">240V</span>';
	return badges;
}

function getRecTypeIcon(type: string): string {
	// Match the labels used in the app's receptacleTypeConfig
	const typeMap: Record<string, string> = {
		'Outlet': '🔌',
		'GFCI Outlet': '🛡',
		'Smart Switch': '🏠',
		'Dimmer Switch': '🔆',
		'On/Off Switch': '⏻',
		'On/Off Relay': '⚡',
		'Timer Switch': '⏱',
		'Networking': '🌐',
		'Coax': '📡',
		'Light - Ceiling': '💡',
		'Light - Wall Mounted': '💡',
		'Lamp/Other Light': '💡',
		'Ceiling Fan/Light': '💡',
		'Camera': '📷',
		'Camera/Light Combo': '📷',
		'Appliance': '🏭',
		'Electronics': '🖥',
		'Vent Fan': '🌀',
	};
	return typeMap[type] || '🔌';
}

/** Open system print dialog with labels laid out for printing */
export function printLabelsPdf(labels: RenderedLabel[], title: string = 'Labels'): void {
	const images = labels.map(label => label.canvas.toDataURL('image/png'));

	const html = `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    @page { size: auto; margin: 5mm; }
    body { margin: 0; padding: 0; font-family: sans-serif; }
    .label { page-break-inside: avoid; margin-bottom: 4mm; display: block; }
    .label img { max-width: 100%; height: auto; image-rendering: pixelated; }
  </style>
</head>
<body>
  ${images.map((src, i) => `<div class="label"><img src="${src}" alt="Label ${i + 1}" /></div>`).join('\n  ')}
</body>
</html>`;

	const printWindow = window.open('', '_blank', 'width=400,height=600');
	if (!printWindow) {
		// Fallback to download
		labels.forEach((label, i) => downloadLabelAsPng(label, `label-${i + 1}.png`));
		return;
	}

	printWindow.document.write(html);
	printWindow.document.close();
	printWindow.onload = () => {
		setTimeout(() => {
			printWindow.print();
			printWindow.close();
		}, 250);
	};
}

/** Print a single label at exact physical size */
export function printSingleLabel(label: RenderedLabel, widthMm: number, heightMm: number): void {
	const src = label.canvas.toDataURL('image/png');
	const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
    body { margin: 0; display: flex; align-items: center; justify-content: center; }
    img { width: ${widthMm}mm; height: auto; image-rendering: pixelated; }
  </style>
</head>
<body><img src="${src}" /></body>
</html>`;

	const printWindow = window.open('', '_blank', 'width=400,height=300');
	if (!printWindow) {
		downloadLabelAsPng(label);
		return;
	}
	printWindow.document.write(html);
	printWindow.document.close();
	printWindow.onload = () => {
		setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
	};
}

/** Download all labels as individual PNGs */
export function downloadAllLabelsAsPng(labels: RenderedLabel[], prefix: string = 'label'): void {
	labels.forEach((label, i) => {
		setTimeout(() => downloadLabelAsPng(label, `${prefix}-${i + 1}.png`), i * 200);
	});
}
