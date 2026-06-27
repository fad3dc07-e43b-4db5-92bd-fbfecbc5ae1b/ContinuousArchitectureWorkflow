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

// Valida un archivo fuente compatible con Archi y ArchiMate dentro de `artifact/source`.
// El script exige un único archivo `design.archimate` y comprueba marcadores típicos
// de un export de Archi antes de escribir el reporte.
const config = {
  sourcePath: resolveArgPath('--source-path', path.join(process.cwd(), 'artifact/source')),
  expectedFileName: getArg('--expected-file', 'design.archimate'),
  expectedRootTag: getArg('--expected-root-tag', 'archimate:model'),
  reportFile: resolveArgPath('--report-file', path.join(process.cwd(), 'archimate-source-report.json')),
};

const state = createValidationState();

function isDirectory(targetPath) {
  return fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
}

function listVisibleEntries(folderPath) {
  return fs.readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inspectSourceFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const normalized = text.replace(/^\uFEFF?\s*<\?xml[\s\S]*?\?>\s*/, '');
  const openTagMatch = normalized.match(/^<\s*([A-Za-z0-9_.:-]+)([^>]*)>/);
  const openTag = openTagMatch ? openTagMatch[1] : '';
  const hasClosingTag = normalized.includes(`</${config.expectedRootTag}>`);
  const hasArchimateNamespace = /xmlns:archimate\s*=\s*['"][^'"]+['"]/i.test(text);

  return {
    text,
    openTag,
    hasClosingTag,
    hasArchimateNamespace,
  };
}

function validateSourceFolder() {
  if (!isDirectory(config.sourcePath)) {
    failValidation(state, `La carpeta fuente '${config.sourcePath}' no existe o no es un directorio.`);
    return;
  }

  // La carpeta fuente debe contener un único archivo visible con el nombre esperado.
  const visibleEntries = listVisibleEntries(config.sourcePath);
  const expectedFilePath = path.resolve(config.sourcePath, config.expectedFileName);
  const exactMatch = visibleEntries.length === 1
    && visibleEntries[0].name === config.expectedFileName
    && visibleEntries[0].isFile
    && !visibleEntries[0].isDirectory;

  if (!exactMatch) {
    failValidation(state, `Se esperaba solo '${expectedFilePath}' dentro de '${config.sourcePath}', pero se encontró: ${JSON.stringify(visibleEntries.map((entry) => entry.name))}.`);
    return;
  }

  const sourceFile = inspectSourceFile(expectedFilePath);
  if (!sourceFile.text.trim()) {
    failValidation(state, `'${expectedFilePath}' está vacío.`);
    return;
  }

  if (sourceFile.openTag !== config.expectedRootTag) {
    failValidation(state, `'${expectedFilePath}' no tiene un elemento raíz de modelo ArchiMate.`);
    return;
  }

  if (!sourceFile.hasArchimateNamespace || !/\bmodel\b/i.test(sourceFile.openTag)) {
    failValidation(state, `'${expectedFilePath}' no tiene el namespace de ArchiMate o los atributos base del modelo.`);
    return;
  }

  if (!sourceFile.hasClosingTag) {
    failValidation(state, `'${expectedFilePath}' no tiene la etiqueta de cierre del modelo ArchiMate.`);
    return;
  }

  addValidationCheck(state, 'archimate_model_root', 'PASS', sourceFile.openTag);
  addValidationCheck(state, 'archimate_namespace', 'PASS', sourceFile.hasArchimateNamespace ? 'presente' : 'ausente');
}

function finalizeChecks() {
  // Si ninguna verificación específica corrió, deja una marca única para el reporte.
  if (state.checks.length === 0) {
    addValidationCheck(state, 'design_archimate', state.status);
  }
}

function writeReport() {
  const report = createValidationReport({ path: config.sourcePath }, state);

  // Escribe el reporte en disco; el workflow lo lee y lo publica como salida.
  writeJsonReport(config.reportFile, report);
  process.stdout.write(`${report.status}\n`);
}

function main() {
  validateSourceFolder();
  finalizeChecks();
  writeReport();
}

main();
