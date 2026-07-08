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
}

interface DirectoryData {
	panelName: string;
	location?: string;
	capacity?: number;
	serviceSize?: string;
	circuits: DirectoryCircuit[];
}

/** Print a panel directory as a letter-size PDF via system dialog */
export function printPanelDirectoryPdf(data: DirectoryData): void {
	const { panelName, location, capacity, serviceSize, circuits } = data;
	const sorted = [...circuits].sort((a, b) => a.number - b.number);
	const maxSlot = Math.max(...sorted.map(c => c.number), 0);
	const totalRows = Math.ceil(maxSlot / 2);

	const circuitBySlot = new Map<number, DirectoryCircuit>();
	for (const c of sorted) circuitBySlot.set(c.number, c);

	let tableRows = '';
	for (let row = 0; row < totalRows; row++) {
		const oddSlot = row * 2 + 1;
		const evenSlot = row * 2 + 2;
		const left = circuitBySlot.get(oddSlot);
		const right = circuitBySlot.get(evenSlot);

		const leftName = left ? escapeHtml(left.name || 'Unnamed') : '';
		const leftAmps = left ? `${left.amps}A` : '';
		const leftBadges = left ? getBadges(left) : '';
		const rightName = right ? escapeHtml(right.name || 'Unnamed') : '';
		const rightAmps = right ? `${right.amps}A` : '';
		const rightBadges = right ? getBadges(right) : '';

		tableRows += `<tr>
			<td class="num">${oddSlot}</td>
			<td class="name">${leftName} ${leftBadges}</td>
			<td class="amps">${leftAmps}</td>
			<td class="divider"></td>
			<td class="amps r">${rightAmps}</td>
			<td class="name r">${rightName} ${rightBadges}</td>
			<td class="num">${evenSlot}</td>
		</tr>`;
	}

	const subtitle = [serviceSize, capacity ? `${capacity} spaces` : '', location].filter(Boolean).join(' · ');
	const date = new Date().toLocaleDateString();

	const html = `<!DOCTYPE html>
<html>
<head>
<title>${panelName} Directory</title>
<style>
@page { size: letter; margin: 0.75in; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 0; color: #1a1a1a; }
h1 { font-size: 22px; margin: 0 0 4px; text-align: center; }
.subtitle { font-size: 12px; color: #555; text-align: center; margin-bottom: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th { background: #f0f0f0; padding: 6px 8px; font-weight: 600; text-align: left; border: 1px solid #ccc; }
td { padding: 5px 8px; border: 1px solid #ddd; vertical-align: middle; }
tr:nth-child(even) { background: #fafafa; }
.num { width: 28px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
.name { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name.r { text-align: right; }
.amps { width: 36px; font-weight: 600; font-variant-numeric: tabular-nums; text-align: center; }
.amps.r { text-align: center; }
.divider { width: 4px; background: #333; padding: 0; border: 1px solid #333; }
.badge { font-size: 9px; padding: 1px 4px; border-radius: 3px; font-weight: 600; margin-left: 4px; }
.gfci { background: #dcfce7; color: #166534; }
.afci { background: #dbeafe; color: #1e40af; }
.v240 { background: #fef3c7; color: #92400e; }
.footer { margin-top: 12px; font-size: 10px; color: #888; text-align: center; }
</style>
</head>
<body>
<h1>${escapeHtml(panelName)}</h1>
<p class="subtitle">${escapeHtml(subtitle)}</p>
<table>
<thead>
<tr><th class="num">#</th><th>Circuit (Odd/Left)</th><th>A</th><th class="divider"></th><th>A</th><th style="text-align:right">Circuit (Even/Right)</th><th class="num">#</th></tr>
</thead>
<tbody>${tableRows}</tbody>
</table>
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

function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getBadges(c: DirectoryCircuit): string {
	let badges = '';
	if (c.gfci) badges += '<span class="badge gfci">GFCI</span>';
	if (c.afci) badges += '<span class="badge afci">AFCI</span>';
	if (c.poles && c.poles > 1) badges += '<span class="badge v240">240V</span>';
	return badges;
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
