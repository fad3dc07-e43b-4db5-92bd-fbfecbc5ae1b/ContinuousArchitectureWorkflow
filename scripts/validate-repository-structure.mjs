import fs from 'node:fs';
import path from 'node:path';

function getArg(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const repoRoot = path.resolve(getArg('--repo-root', process.cwd()));
const repoName = path.basename(repoRoot);
const repositoryNamePattern = getArg('--repository-name-pattern', '^(SBB-(SD|AM|BS)-[0-9]{4}|BS-[0-9]{4})$');
const reportFile = path.resolve(getArg('--report-file', path.join(process.cwd(), 'repository-structure-report.json')));

const requiredPaths = [
  ['README.md', 'file'],
  ['.github/workflows/validate.yml', 'file'],
  ['artifact', 'dir'],
  ['artifact/source', 'dir'],
  ['artifact/exchange', 'dir'],
  ['artifact/exchange/design.openexchange.xml', 'file'],
];

const observations = [];
const checks = [];
const repoOk = new RegExp(repositoryNamePattern).test(repoName);

if (!repoOk) {
  observations.push(`Repository name '${repoName}' does not match '${repositoryNamePattern}'.`);
}

for (const [relativePath, expectedKind] of requiredPaths) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const exists = fs.existsSync(absolutePath);
  const kindOk = exists && (expectedKind === 'file' ? fs.statSync(absolutePath).isFile() : fs.statSync(absolutePath).isDirectory());
  if (!kindOk) {
    observations.push(`Expected ${expectedKind} '${relativePath}' is missing or invalid.`);
  }
  checks.push({ path: relativePath, kind: expectedKind, status: kindOk ? 'PASS' : 'FAIL' });
}

const status = repoOk && checks.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL';
const report = {
  name: repoName,
  status,
  checks: [{ name: 'repository_name', status: repoOk ? 'PASS' : 'FAIL' }, ...checks],
  observations,
};

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${status}\n`);
