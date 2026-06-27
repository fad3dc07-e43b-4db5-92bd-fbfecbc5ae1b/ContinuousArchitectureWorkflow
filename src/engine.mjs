import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getArg, resolveArgPath } from './infra/args.mjs';
import { loadYamlFile } from './infra/yaml.mjs';
import { validateManifestData, validateRuleSetData } from './core/schemas.mjs';
import { getCheckRule } from './checks/index.mjs';

export const Engine = {
  version: '1.0.0',
  defaultRepoPath: '.',

  init() {
    console.log(`Iniciando motor v${Engine.version}...`);
  },

  validateYaml(filePath) {
    return loadYamlFile(filePath);
  },

  loadManifestValidators(manifestPath) {
    const manifest = validateManifestData(loadYamlFile(manifestPath), manifestPath);
    const manifestDir = path.dirname(manifestPath);
    const rules = [];

    for (const entry of manifest.rules ?? []) {
      const ruleSetPath = path.resolve(manifestDir, entry.ruleFile);
      const ruleSet = validateRuleSetData(loadYamlFile(ruleSetPath), ruleSetPath);
      rules.push({
        id: entry.ruleFile,
        title: entry.title ?? ruleSet.title ?? entry.ruleFile,
        description: entry.description ?? ruleSet.description,
        schemaVersion: ruleSet.schemaVersion ?? 1,
        tool: ruleSet.tool,
        format: ruleSet.format,
        dialect: ruleSet.dialect,
        target: ruleSet.target,
        purpose: ruleSet.purpose,
        scope: ruleSet.scope,
        checks: ruleSet.checks ?? [],
      });
    }

    return rules;
  },

  evaluateRules(repoRoot, ruleSet) {
    const state = { status: 'PASS', observations: [], checks: [] };
    const repoName = path.basename(repoRoot);

    if (ruleSet.schemaVersion !== undefined && ruleSet.schemaVersion !== 1) {
      state.status = 'FAIL';
      state.observations.push(`Versión de esquema no soportada: '${ruleSet.schemaVersion}'.`);
    }

    for (const check of ruleSet.checks ?? []) {
      const rule = getCheckRule(check.type);
      const context = { repoRoot, repoName, absolutePath: path.resolve(repoRoot, check.path), check };
      const result = rule ? rule.evaluate(context) : { status: 'FAIL', detail: check.type, error: `Regla desconocida: '${check.type}'.` };
      state.checks.push({ id: check.id || check.type, description: check.description, status: result.status, detail: result.detail, failureMessage: result.error ?? check.failureMessage, target: rule?.target });

      if (result.status === 'FAIL') {
        state.status = 'FAIL';
        state.observations.push(result.error ?? check.failureMessage ?? `Regla desconocida: '${check.type}'.`);
      }
    }

    state.status = state.status === 'PASS' && state.checks.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL';
    return state;
  },

  buildResponse(manifestPath, validators) {
    return {
      manifest: manifestPath,
      status: validators.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL',
      summary: { pass: validators.filter((item) => item.status === 'PASS').length, fail: validators.filter((item) => item.status === 'FAIL').length },
      validators,
    };
  },

  runManifest(repoRoot, manifestPath) {
    const validators = this.loadManifestValidators(manifestPath).map((ruleSet) => ({
      ...ruleSet,
      ...this.evaluateRules(repoRoot, ruleSet),
    }));

    return this.buildResponse(manifestPath, validators);
  },

  renderSummary(response) {
    const lines = [];
    lines.push('| Regla | Estado |');
    lines.push('|---|---|');

    for (const validator of response.validators ?? []) {
      lines.push(`| ${validator.title ?? validator.id ?? 'Sin título'} | \`${validator.status ?? 'UNKNOWN'}\` |`);
    }

    lines.push('');
    lines.push(`- Estado global: \`${response.status ?? 'UNKNOWN'}\``);
    lines.push(`- Reglas OK: \`${response.summary?.pass ?? 0}\``);
    lines.push(`- Reglas con fallo: \`${response.summary?.fail ?? 0}\``);
    if (response.error) {
      lines.push(`- Error: ${response.error}`);
    }

    for (const validator of response.validators ?? []) {
      lines.push('');
      lines.push(`### ${validator.title ?? validator.id ?? 'Regla'}`);
      lines.push(`- Esquema: \`${validator.schemaVersion ?? 'UNKNOWN'}\``);
      lines.push(`- Herramienta: \`${validator.tool ?? 'UNKNOWN'}\``);
      lines.push(`- Formato: \`${validator.format ?? 'UNKNOWN'}\``);
      lines.push(`- Dialecto: \`${validator.dialect ?? 'UNKNOWN'}\``);
      if (validator.target?.path) {
        lines.push(`- Objetivo: \`${validator.target.path}\``);
      }
      if (validator.purpose) {
        lines.push(`- Propósito: ${validator.purpose}`);
      }
      lines.push(`- Estado: \`${validator.status ?? 'UNKNOWN'}\``);
      for (const check of validator.checks ?? []) {
        const detail = check.detail === undefined ? '' : ` (${check.detail})`;
        lines.push(`- ${check.id}: ${check.description ? `${check.description} ` : ''}\`${check.status}\`${detail}`);
      }
      for (const item of validator.observations ?? []) {
        lines.push(`- ${item}`);
      }
    }

    return `${lines.join('\n')}\n`;
  },

  main() {
    const mode = getArg('--mode', 'validate');

    if (mode === 'summary') {
      const response = JSON.parse(process.env.VALIDATION_RESPONSE?.trim() || '{}');
      const summaryFile = process.env.GITHUB_STEP_SUMMARY;

      if (summaryFile) {
        fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
        fs.writeFileSync(summaryFile, this.renderSummary(response), 'utf8');
      }

      process.stdout.write(`${response.status ?? 'FAIL'}\n`);
      return;
    }

    const repoRoot = resolveArgPath('--repo-root', process.cwd());
    const manifestPath = resolveArgPath('--manifest', path.join(process.cwd(), 'rules/manifest.yaml'));

    try {
      const response = this.runManifest(repoRoot, manifestPath);
      process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      const response = this.buildErrorResponse(manifestPath, error);
      process.stdout.write(`${JSON.stringify(response)}\n`);
      process.exitCode = 1;
    }
  },
};

Engine.buildErrorResponse = function buildErrorResponse(manifestPath, error) {
  return {
    manifest: manifestPath,
    status: 'FAIL',
    summary: { pass: 0, fail: 0 },
    validators: [],
    error: error instanceof Error ? error.message : String(error),
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Engine.main();
}
