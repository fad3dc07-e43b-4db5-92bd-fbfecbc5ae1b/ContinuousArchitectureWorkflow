import fs from 'node:fs';
import path from 'node:path';

function getArg(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const sourcePath = path.resolve(getArg('--source-path', path.join(process.cwd(), 'artifact/source')));
const expectedFile = path.resolve(sourcePath, 'design.archimate');
const reportFile = path.resolve(getArg('--report-file', path.join(process.cwd(), 'archimate-source-report.json')));

const observations = [];
const checks = [];
let status = 'PASS';

if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
  status = 'FAIL';
  observations.push(`Source folder '${sourcePath}' is missing or not a directory.`);
} else {
  const visibleEntries = fs.readdirSync(sourcePath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const exactMatch = visibleEntries.length === 1
    && visibleEntries[0].name === 'design.archimate'
    && visibleEntries[0].isFile
    && !visibleEntries[0].isDirectory;

  if (!exactMatch) {
    status = 'FAIL';
    observations.push(`Expected only '${expectedFile}' under '${sourcePath}', found: ${JSON.stringify(visibleEntries.map((entry) => entry.name))}.`);
  } else {
    const text = fs.readFileSync(expectedFile, 'utf8');
    const normalized = text.replace(/^\uFEFF?\s*<\?xml[\s\S]*?\?>\s*/, '');
    const openTagMatch = normalized.match(/^<\s*([A-Za-z0-9_.:-]+)([^>]*)>/);
    const openTag = openTagMatch ? openTagMatch[1] : '';
    const hasClosingTag = /<\s*\/\s*archimate:model\s*>/i.test(normalized);
    const hasArchimateNamespace = /xmlns:archimate\s*=\s*['"][^'"]+['"]/i.test(text);

    if (!text.trim()) {
      status = 'FAIL';
      observations.push(`'${expectedFile}' is empty.`);
    } else if (openTag !== 'archimate:model') {
      status = 'FAIL';
      observations.push(`'${expectedFile}' does not have an ArchiMate model root element.`);
    } else if (!hasArchimateNamespace || !/\bmodel\b/i.test(openTag)) {
      status = 'FAIL';
      observations.push(`'${expectedFile}' is missing the ArchiMate namespace or model root attributes.`);
    } else if (!hasClosingTag) {
      status = 'FAIL';
      observations.push(`'${expectedFile}' is missing the closing ArchiMate model tag.`);
    } else {
      checks.push({ name: 'archimate_model_root', status: 'PASS', detail: openTag });
      checks.push({ name: 'archimate_namespace', status: 'PASS', detail: hasArchimateNamespace ? 'present' : 'missing' });
    }
  }
}

if (checks.length === 0) {
  checks.push({ name: 'design_archimate', status });
}

const report = {
  path: sourcePath,
  status,
  checks,
  observations,
};

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${status}\n`);
