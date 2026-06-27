import fs from 'node:fs';
import path from 'node:path';

// Helpers compartidos para los scripts de gobernanza.
// Mantiene la lógica repetida fuera de los validadores y del renderer.
export function getArg(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

export function resolveArgPath(name, fallback) {
  return path.resolve(getArg(name, fallback));
}

export function createValidationState() {
  return {
    status: 'PASS',
    observations: [],
    checks: [],
  };
}

export function failValidation(state, message) {
  state.status = 'FAIL';
  state.observations.push(message);
}

export function addValidationCheck(state, name, status, detail) {
  state.checks.push(detail === undefined ? { name, status } : { name, status, detail });
}

export function computeValidationStatus(state) {
  return state.status === 'PASS' && state.checks.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL';
}

export function createValidationReport(base, state) {
  return {
    ...base,
    status: computeValidationStatus(state),
    checks: state.checks,
    observations: state.observations,
  };
}

export function writeJsonReport(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function writeTextFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

export function readJsonEnv(name, fallback = '{}') {
  return JSON.parse(process.env[name] ?? fallback);
}
