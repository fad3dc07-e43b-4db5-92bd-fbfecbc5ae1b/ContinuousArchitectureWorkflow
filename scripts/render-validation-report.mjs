import fs from 'node:fs';

const structureReport = JSON.parse(process.env.STRUCTURE_REPORT ?? '{}');
const sourceReport = JSON.parse(process.env.SOURCE_REPORT ?? '{}');
const summaryFile = process.env.GITHUB_STEP_SUMMARY;

const lines = [];
lines.push('| Check | Status |');
lines.push('|---|---|');
lines.push(`| Repository structure | \`${structureReport.status ?? 'UNKNOWN'}\` |`);
lines.push(`| Archimate source | \`${sourceReport.status ?? 'UNKNOWN'}\` |`);
lines.push('');
lines.push(`- Structure: \`${structureReport.status ?? 'UNKNOWN'}\``);
for (const item of structureReport.observations ?? []) {
  lines.push(`  - ${item}`);
}
lines.push(`- Source: \`${sourceReport.status ?? 'UNKNOWN'}\``);
for (const item of sourceReport.observations ?? []) {
  lines.push(`  - ${item}`);
}

if (summaryFile) {
  fs.writeFileSync(summaryFile, `${lines.join('\n')}\n`, 'utf8');
}

const overall = structureReport.status === 'PASS' && sourceReport.status === 'PASS' ? 'PASS' : 'FAIL';
process.stdout.write(`${overall}\n`);
