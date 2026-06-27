import fs from 'node:fs';
import path from 'node:path';
import {
  addValidationCheck,
  createValidationReport,
  createValidationState,
  failValidation,
  getArg,
  resolveArgPath,
  writeJsonReport,
} from './common.mjs';

// Valida la estructura base esperada para un activo arquitectónico gobernado.
// Comprueba el nombre del repositorio y el layout mínimo de carpetas/archivos,
// y luego escribe un reporte JSON para que el workflow lo consuma.
const repoRoot = resolveArgPath('--repo-root', process.cwd());
const repoName = path.basename(repoRoot);
const repositoryNamePattern = getArg('--repository-name-pattern', '^(SBB-(SD|AM|BS)-[0-9]{4}|BS-[0-9]{4})$');
const reportFile = resolveArgPath('--report-file', path.join(process.cwd(), 'repository-structure-report.json'));

const requiredPaths = [
  ['README.md', 'file'],
  ['.github/workflows/validate.yml', 'file'],
  ['artifact', 'dir'],
  ['artifact/source', 'dir'],
  ['artifact/exchange', 'dir'],
  ['artifact/exchange/design.openexchange.xml', 'file'],
];

const state = createValidationState();
const repoOk = new RegExp(repositoryNamePattern).test(repoName);

// Conserva un rastro legible para el reporte final.
if (!repoOk) {
  failValidation(state, `Repository name '${repoName}' does not match '${repositoryNamePattern}'.`);
}

// Valida cada ruta requerida como archivo o carpeta según corresponda.
for (const [relativePath, expectedKind] of requiredPaths) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const exists = fs.existsSync(absolutePath);
  const kindOk = exists && (expectedKind === 'file' ? fs.statSync(absolutePath).isFile() : fs.statSync(absolutePath).isDirectory());
  if (!kindOk) {
    failValidation(state, `Expected ${expectedKind} '${relativePath}' is missing or invalid.`);
  }
  addValidationCheck(state, relativePath, kindOk ? 'PASS' : 'FAIL', expectedKind);
}

// Consolida las verificaciones en un estado único para CI.
addValidationCheck(state, 'repository_name', repoOk ? 'PASS' : 'FAIL');
const report = createValidationReport({ name: repoName }, state);

// Persiste el reporte JSON para que el workflow lo exponga como salida.
writeJsonReport(reportFile, report);
process.stdout.write(`${report.status}\n`);
