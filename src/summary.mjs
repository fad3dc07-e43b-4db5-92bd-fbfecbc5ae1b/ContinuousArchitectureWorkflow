import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYamlFile } from './infra/yaml.mjs';

export async function renderDesignSummary(response) {
  if (response.systemStatus === 'ERROR') {
    return `${renderSystemErrorSummary(response).join('\n').trimEnd()}\n`;
  }

  const summary = buildSummaryModelFromReports(response.reports ?? {}, response.status);
  return `${await renderSummaryMarkdownV03(summary)}\n`;
}

function buildSummaryModelFromReports(reports, reportStatus) {
  const qualityScore = reports?.qualityScore ?? {};
  const quickchart = reports?.quickchart ?? {};
  const ruleResults = Array.isArray(reports?.ruleResults)
    ? reports.ruleResults
    : Array.isArray(reports?.rules)
      ? reports.rules
      : [];

  const ruleMap = new Map(ruleResults.map((rule) => [rule.ruleId, rule]));
  const businessRules = ruleResults.filter((rule) => rule.ruleId !== 'contract_consistency_check');
  const contractRule = ruleMap.get('contract_consistency_check') ?? null;
  const dimensions = Array.isArray(qualityScore.dimensions) ? qualityScore.dimensions : [];
  const evaluatedDimensions = dimensions.filter((dimension) => Number.isFinite(dimension.score));
  const omittedDimensions = dimensions.filter((dimension) => !Number.isFinite(dimension.score)).map((dimension) => dimension.label);
  const counts = countRuleStatuses(businessRules);
  const partial = Boolean(qualityScore.partial) || omittedDimensions.length > 0;
  const qualityStatus = mapQualityStatus(qualityScore.status, partial);
  const coverage = `${evaluatedDimensions.length}/${dimensions.length}`;
  const quickchartIssues = compareQuickchartToQualityScore(quickchart, qualityScore);
  const contractIssues = buildContractIssues(contractRule, quickchartIssues);
  const contractOk = contractIssues.length === 0;
  const generalState = partial ? 'Evaluación parcial' : (contractOk ? qualityStatus : 'Contrato inconsistente');
  const scoreLabel = qualityScore.overallScore === null || qualityScore.overallScore === undefined
    ? 'n/a'
    : `${qualityScore.overallScore}/100${partial ? ' (parcial)' : ''}`;

  return {
    qualityScore,
    quickchart,
    ruleResults: businessRules,
    contractRule,
    counts,
    partial,
    qualityStatus,
    coverage,
    contractOk,
    contractIssues,
    generalState,
    scoreLabel,
    omittedDimensions,
    radarTrusted: contractOk,
    quickchartConfig: contractOk && quickchart?.type && quickchart?.data && quickchart?.options
      ? {
        type: quickchart.type,
        data: quickchart.data,
        options: quickchart.options,
      }
      : null,
  };
}

function countRuleStatuses(ruleResults) {
  return ruleResults.reduce((acc, rule) => {
    const key = String(rule.status ?? 'unknown').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(acc, key)) {
      acc[key] = 0;
    }
    acc[key] += 1;
    return acc;
  }, { pass: 0, warning: 0, fail: 0, notimplemented: 0 });
}

function mapQualityStatus(status, partial) {
  if (partial) {
    return 'Evaluación parcial';
  }

  const value = String(status ?? '').toLowerCase();
  if (value === 'pass') return 'Cumple';
  if (value === 'warning') return 'Cumple con advertencias';
  if (value === 'fail') return 'No cumple';
  return 'No evaluado';
}

function compareQuickchartToQualityScore(quickchart, qualityScore) {
  const included = (qualityScore?.dimensions ?? []).filter((dimension) => Number.isFinite(dimension.score));
  const radarLabels = quickchart?.data?.labels ?? [];
  const expectedLabels = included.map((dimension) => dimension.label);
  const evaluatedSeries = quickchart?.data?.datasets?.[0]?.data ?? [];
  const targetSeries = quickchart?.data?.datasets?.[1]?.data ?? [];
  const expectedScores = included.map((dimension) => dimension.score);
  const expectedTargets = included.map((dimension) => dimension.target);
  const issues = [];

  if (!arraysEqual(radarLabels, expectedLabels)) {
    issues.push('quickchart-radar.json no coincide con quality-score.json en el orden de dimensiones.');
  }

  if (!arraysEqual(evaluatedSeries, expectedScores)) {
    issues.push('quickchart-radar.json no coincide con quality-score.json en el dataset Evaluado.');
  }

  if (!arraysEqual(targetSeries, expectedTargets)) {
    issues.push('quickchart-radar.json no coincide con quality-score.json en el dataset Objetivo.');
  }

  if (Boolean(quickchart?.partial) !== Boolean(qualityScore?.partial)) {
    issues.push('quickchart-radar.json no coincide con el indicador partial.');
  }

  const omittedDimensions = (qualityScore?.dimensions ?? [])
    .filter((dimension) => !Number.isFinite(dimension.score))
    .map((dimension) => dimension.label);

  if (!arraysEqual(quickchart?.omittedDimensions ?? [], omittedDimensions)) {
    issues.push('quickchart-radar.json no coincide con las dimensiones omitidas.');
  }

  return issues;
}

function buildContractIssues(contractRule, quickchartIssues) {
  const issues = [...quickchartIssues];

  if (!contractRule) {
    issues.push('Falta el resultado interno contract_consistency_check en rule-results.json.');
    return issues;
  }

  for (const finding of contractRule.findings ?? []) {
    if (finding?.message) {
      issues.push(finding.message);
    }
  }

  if (contractRule.includeInQualityScore !== false) {
    issues.push('contract_consistency_check debe tener includeInQualityScore: false.');
  }

  if (contractRule.includeInRadar !== false) {
    issues.push('contract_consistency_check debe tener includeInRadar: false.');
  }

  if (String(contractRule.status ?? '') !== 'pass') {
    issues.push('contract_consistency_check falló.');
  }

  return issues;
}

async function renderSummaryMarkdownV03(summary) {
  const lines = ['# Calidad del diseño', ''];

  if (summary.contractIssues.length > 0) {
    lines.push('> [!CAUTION]');
    lines.push('> **ERROR DE CONTRATO**');
    lines.push('>');
    lines.push('> El radar y el score no se consideran confiables hasta corregir la inconsistencia.');
    lines.push('');
  }

  if (summary.partial) {
    lines.push('> [!CAUTION]');
    lines.push('> **EVALUACIÓN PARCIAL**');
    lines.push('>');
    lines.push(`> Cobertura actual: ${summary.coverage} dimensiones evaluadas.`);
    if (summary.omittedDimensions.length > 0) {
      lines.push(`> Dimensiones omitidas: ${summary.omittedDimensions.join(', ')}.`);
    }
    lines.push('');
  }

  lines.push('## Resumen');
  lines.push('');
  lines.push('| Estado general | Score | Cobertura | PASS | WARNING | FAIL | NOT IMPLEMENTED | Contrato |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | --- |');
  lines.push(`| ${summary.generalState} | ${summary.scoreLabel} | ${summary.coverage} | ${summary.counts.pass} | ${summary.counts.warning} | ${summary.counts.fail} | ${summary.counts.notimplemented} | ${summary.contractOk ? 'OK' : 'ERROR'} |`);
  lines.push('');

  lines.push('## Radar');
  lines.push('');
  if (summary.radarTrusted && summary.quickchartConfig) {
    try {
      const radarUrl = await createQuickChartUrl(summary.quickchartConfig, { width: 520, height: 360 });
      if (summary.partial) {
        lines.push('> [!WARNING]');
        lines.push(`> Radar parcial: omite ${summary.omittedDimensions.join(', ')}.`);
        lines.push('');
      }
      lines.push(`<img src="${radarUrl}" alt="Radar de calidad" width="520" height="360">`);
      lines.push('');
      lines.push('<small>Fuente: `reports/quickchart-radar.json`</small>');
    } catch (error) {
      lines.push('> [!CAUTION]');
      lines.push('> No se pudo generar el radar desde `reports/quickchart-radar.json`.');
      lines.push(`> **Detalle:** ${normalizeInlineText(error?.message ?? 'QuickChart no respondió.')}`);
    }
  } else {
    lines.push('> [!CAUTION]');
    lines.push('> El radar no es confiable porque el contrato es inconsistente.');
    if (summary.contractIssues.length > 0) {
      lines.push('>');
      for (const issue of summary.contractIssues) {
        lines.push(`> - ${normalizeInlineText(issue)}`);
      }
    }
  }

  lines.push('');
  lines.push('## Dimensiones');
  lines.push('');
  lines.push('| Dimensión | Score | Target | Estado | Reglas evaluadas |');
  lines.push('| --- | ---: | ---: | --- | ---: |');
  for (const dimension of summary.qualityScore.dimensions ?? []) {
    lines.push(`| ${dimension.label} | ${formatDimensionScore(dimension.score)} | ${formatDimensionScore(dimension.target)} | ${formatDimensionState(dimension.status)} | ${formatDimensionScore(dimension.includedRules)} |`);
  }
  lines.push('');

  lines.push('## Observaciones');
  lines.push('');
  const warningsByDimension = groupRulesByDimension(summary.ruleResults.filter((rule) => String(rule.status ?? '').toLowerCase() === 'warning'));

  if (warningsByDimension.size === 0) {
    lines.push('> [!TIP]');
    lines.push('> No hay observaciones WARNING.');
    lines.push('');
  } else {
    for (const [dimension, rules] of warningsByDimension) {
      lines.push(`<details>`);
      lines.push(`<summary>${dimension} (${rules.length})</summary>`);
      lines.push('');
      lines.push('| Regla | Severidad | Score | Evaluadas | Pasadas | Falladas | Hallazgos | Mensaje |');
      lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
      for (const rule of rules) {
        lines.push(`| \`${escapeInlineCode(rule.ruleId)}\` | ${normalizeInlineText(rule.severity)} | ${formatDimensionScore(rule.score)} | ${formatDimensionScore(rule.evaluated)} | ${formatDimensionScore(rule.passed)} | ${formatDimensionScore(rule.failed)} | ${formatDimensionScore(rule.findings?.length ?? 0)} | ${normalizeInlineText(getFailureMessage(rule))} |`);
      }
      lines.push('');

      for (const rule of rules) {
        if ((rule.findings ?? []).length === 0) {
          continue;
        }

        lines.push(`<details>`);
        lines.push(`<summary>${rule.ruleId} (${rule.findings.length} hallazgos)</summary>`);
        lines.push('');
        lines.push('| recordId | field | value | message |');
        lines.push('| --- | --- | --- | --- |');
        for (const finding of rule.findings) {
          lines.push(`| ${normalizeInlineText(finding.recordId ?? 'n/a')} | ${normalizeInlineText(finding.field ?? 'n/a')} | ${normalizeInlineText(formatFindingValue(finding.value))} | ${normalizeInlineText(finding.message ?? 'n/a')} |`);
        }
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }

      lines.push('</details>');
      lines.push('');
    }
  }

  lines.push('## Reglas cumplidas');
  lines.push('');
  lines.push('<details>');
  lines.push('<summary>Ver reglas cumplidas</summary>');
  lines.push('');
  const passByDimension = groupRulesByDimension(summary.ruleResults.filter((rule) => String(rule.status ?? '').toLowerCase() === 'pass'));
  if (passByDimension.size === 0) {
    lines.push('_Sin reglas cumplidas para mostrar._');
  } else {
    for (const [dimension, rules] of passByDimension) {
      lines.push(`### ${dimension}`);
      lines.push('');
      for (const rule of rules) {
        lines.push(`- \`${escapeInlineCode(rule.ruleId)}\` — ${normalizeInlineText(rule.message ?? rule.reason ?? 'Cumple.')}`);
      }
      lines.push('');
    }
  }
  lines.push('</details>');
  lines.push('');

  lines.push('## Consistencia del contrato');
  lines.push('');
  if (summary.contractIssues.length === 0) {
    lines.push('> [!TIP]');
    lines.push('> **Contrato OK**');
    lines.push('>');
    lines.push('> `contract_consistency_check` confirma que quality-score.json y quickchart-radar.json son consistentes.');
  } else {
    lines.push('> [!CAUTION]');
    lines.push('> **Contrato inconsistente**');
    lines.push('>');
    for (const issue of summary.contractIssues) {
      lines.push(`> - ${normalizeInlineText(issue)}`);
    }
  }

  lines.push('');
  if (summary.contractRule) {
    lines.push('| Regla | Estado | Score | Evaluadas | Pasadas | Falladas |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: |');
    lines.push(`| \`${escapeInlineCode(summary.contractRule.ruleId)}\` | ${normalizeInlineText(summary.contractRule.status)} | ${formatDimensionScore(summary.contractRule.score)} | ${formatDimensionScore(summary.contractRule.evaluated)} | ${formatDimensionScore(summary.contractRule.passed)} | ${formatDimensionScore(summary.contractRule.failed)} |`);
  }

  return lines.join('\n').trimEnd();
}

function groupRulesByDimension(rules) {
  return rules.reduce((groups, rule) => {
    const key = String(rule.dimension ?? 'General');
    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(rule);
    return groups;
  }, new Map());
}

function formatDimensionScore(value) {
  if (value === null || value === undefined) {
    return 'n/a';
  }

  return String(value);
}

function formatDimensionState(status) {
  const value = String(status ?? '').toLowerCase();
  if (value === 'pass') return 'Aprobada';
  if (value === 'warning') return 'Advertencia';
  if (value === 'fail') return 'Bloqueante';
  if (value === 'incomplete') return 'Parcial';
  if (value === 'notimplemented') return 'No implementada';
  return value || 'n/a';
}

function getFailureMessage(rule) {
  const firstFinding = (rule.findings ?? [])[0];
  if (firstFinding?.message) {
    return firstFinding.message;
  }

  if (rule.reason) {
    return rule.reason;
  }

  if (rule.message) {
    return rule.message;
  }

  return 'n/a';
}

function formatFindingValue(value) {
  if (value === null || value === undefined) {
    return 'n/a';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function countChecks(checks) {
  return checks.reduce((acc, check) => {
    const key = check.status ?? 'UNKNOWN';
    if (acc[key] === undefined) {
      acc[key] = 0;
    }
    acc[key] += 1;
    return acc;
  }, { PASS: 0, WARN: 0, FAIL: 0, ERROR: 0 });
}

function validateDesignContracts() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const rulesPath = path.join(root, '.calinter', 'archi-rules.yml');
  const qualityPath = path.join(root, '.calinter', 'archi-quality.yml');
  const catalogPath = path.join(root, 'reports', 'catalog.json');
  const ruleResultsPath = path.join(root, 'reports', 'rule-results.json');
  const qualityScorePath = path.join(root, 'reports', 'quality-score.json');
  const quickchartPath = path.join(root, 'reports', 'quickchart-radar.json');

  const rulesConfig = loadYamlFile(rulesPath);
  const qualityConfig = loadYamlFile(qualityPath);
  const catalog = readJsonFile(catalogPath);
  const ruleResults = readJsonFile(ruleResultsPath);
  const qualityScore = readJsonFile(qualityScorePath);
  const quickchart = readJsonFile(quickchartPath);

  const rulesById = new Map(Object.entries(rulesConfig.rules ?? {}));
  const qualityDimensions = Object.entries(qualityConfig.qualityModel?.dimensions ?? {});
  const ruleResultsById = new Map((ruleResults.rules ?? []).map((rule) => [rule.ruleId, rule]));

  const contractCheck = ruleResultsById.get('contract_consistency_check');
  if (!contractCheck) {
    throw new Error('Contrato inconsistente: falta el resultado interno contract_consistency_check en rule-results.json.');
  }

  if (contractCheck.includeInQualityScore !== false) {
    throw new Error('Contrato inconsistente: contract_consistency_check debe tener includeInQualityScore: false.');
  }

  if (contractCheck.includeInRadar !== false) {
    throw new Error('Contrato inconsistente: contract_consistency_check debe tener includeInRadar: false.');
  }

  if (String(contractCheck.status ?? '') !== 'pass') {
    throw new Error('Contrato inconsistente: contract_consistency_check falló.');
  }

  for (const [, dimension] of qualityDimensions) {
    for (const ruleRef of dimension.rules ?? []) {
      if (!rulesById.has(ruleRef.id)) {
        throw new Error(`Contrato inválido: quality.yml referencia la regla inexistente '${ruleRef.id}'.`);
      }
    }
  }

  for (const dimension of qualityScore.dimensions ?? []) {
    for (const ruleRef of dimension.rules ?? []) {
      if (!ruleResultsById.has(ruleRef.ruleId)) {
        throw new Error(`Contrato inválido: quality-score.json usa la regla '${ruleRef.ruleId}' sin resultado en rule-results.json.`);
      }
    }
  }

  const expectedQualityScore = buildExpectedQualityScore({ qualityConfig, qualityDimensions, ruleResultsById, rulesById });
  assertQualityScoreMatches(qualityScore, expectedQualityScore);
  assertQuickchartMatchesQualityScore(quickchart, qualityScore);

  if (ruleResultsById.get('referencias_rotas_regla')?.status === 'pass') {
    validateCatalogReferences(catalog);
  }
}

function buildExpectedQualityScore({ qualityConfig, qualityDimensions, ruleResultsById, rulesById }) {
  const dimensions = qualityDimensions.map(([dimensionId, dimension]) => {
    const rules = (dimension.rules ?? []).map((ruleRef) => {
      const result = ruleResultsById.get(ruleRef.id);
      if (!result) {
        throw new Error(`Contrato inválido: falta el resultado de la regla '${ruleRef.id}' para recalcular quality-score.json.`);
      }

      return {
        ruleId: ruleRef.id,
        weight: Number(ruleRef.weight) || 0,
        score: result.includeInQualityScore === false || result.status === 'notImplemented' ? null : Number(result.score),
        status: result.status,
      };
    });

    const dimensionPartial = rules.some((rule) => rule.score === null || String(rule.status ?? '').toLowerCase() === 'notimplemented');

    const scoredRules = rules.filter((rule) => rule.score !== null && Number.isFinite(rule.score));
    const weightTotal = scoredRules.reduce((sum, rule) => sum + rule.weight, 0);
    const weightedScore = scoredRules.reduce((sum, rule) => sum + (rule.score * rule.weight), 0);
    const score = weightTotal > 0 ? Math.round(weightedScore / weightTotal) : null;
    const hasCriticalFailure = scoredRules.some((rule) => (ruleResultsById.get(rule.ruleId)?.status === 'fail') && String(rulesById.get(rule.ruleId)?.severity ?? '').toLowerCase() === 'error');
    const target = Number(dimension.target) || 0;
    const status = hasCriticalFailure ? 'fail' : (dimensionPartial ? 'incomplete' : (score === null ? 'incomplete' : (score >= target ? 'pass' : 'warning')));

    return {
      id: dimensionId,
      label: dimension.label,
      target,
      score,
      status,
      weightTotal,
      rules,
    };
  });

  const scoredDimensions = dimensions.filter((dimension) => Number.isFinite(dimension.score));
  const overallScore = scoredDimensions.length > 0
    ? Math.round(scoredDimensions.reduce((sum, dimension) => sum + dimension.score, 0) / scoredDimensions.length)
    : null;
  const status = dimensions.some((dimension) => dimension.status === 'fail')
    ? 'fail'
    : (dimensions.some((dimension) => dimension.status === 'incomplete') ? 'incomplete' : (dimensions.some((dimension) => dimension.status === 'warning') ? 'warning' : 'pass'));

  return {
    overallScore,
    status,
    partial: dimensions.some((dimension) => dimension.status === 'incomplete'),
    radarOrder: dimensions.map((dimension) => dimension.label),
    dimensions,
  };
}

function assertQualityScoreMatches(actual, expected) {
  if (expected.overallScore === null) {
    if (actual?.overallScore !== null) {
      throw new Error('Contrato inválido: quality-score.json no debe inventar overallScore.');
    }
  } else if (Number(actual?.overallScore) !== expected.overallScore) {
    throw new Error(`Contrato inválido: quality-score.json no recalcula el score global esperado (${expected.overallScore}).`);
  }

  if (String(actual?.status ?? '') !== expected.status) {
    throw new Error(`Contrato inválido: quality-score.json no coincide con el estado esperado '${expected.status}'.`);
  }

  if (Boolean(actual?.partial) !== Boolean(expected.partial)) {
    throw new Error('Contrato inválido: quality-score.json no coincide con el indicador partial.');
  }

  if (!arraysEqual(actual?.radarOrder ?? [], expected.radarOrder)) {
    throw new Error('Contrato inválido: quality-score.json no coincide con el orden esperado de dimensiones.');
  }

  const actualDimensions = actual?.dimensions ?? [];
  if (actualDimensions.length !== expected.dimensions.length) {
    throw new Error('Contrato inválido: quality-score.json tiene un número de dimensiones distinto al esperado.');
  }

  for (let index = 0; index < expected.dimensions.length; index += 1) {
    const actualDimension = actualDimensions[index] ?? {};
    const expectedDimension = expected.dimensions[index];

    if (String(actualDimension.id ?? '') !== expectedDimension.id) {
      throw new Error(`Contrato inválido: quality-score.json tiene la dimensión '${actualDimension.id ?? 'desconocida'}' fuera de orden o con id distinto.`);
    }

    if (String(actualDimension.label ?? '') !== expectedDimension.label) {
      throw new Error(`Contrato inválido: quality-score.json no coincide con la etiqueta esperada de '${expectedDimension.label}'.`);
    }

    if (Number(actualDimension.target) !== expectedDimension.target) {
      throw new Error(`Contrato inválido: quality-score.json no coincide con el target de '${expectedDimension.label}'.`);
    }

    if (expectedDimension.score === null) {
      if (actualDimension.score !== null) {
        throw new Error(`Contrato inválido: quality-score.json debe dejar sin score a '${expectedDimension.label}'.`);
      }
    } else if (Number(actualDimension.score) !== expectedDimension.score) {
      throw new Error(`Contrato inválido: quality-score.json no recalcula el score de '${expectedDimension.label}'.`);
    }

    if (String(actualDimension.status ?? '') !== expectedDimension.status) {
      throw new Error(`Contrato inválido: quality-score.json no coincide con el estado de '${expectedDimension.label}'.`);
    }

    if (Number(actualDimension.weightTotal) !== expectedDimension.weightTotal) {
      throw new Error(`Contrato inválido: quality-score.json no coincide con el peso total de '${expectedDimension.label}'.`);
    }

    const actualRules = actualDimension.rules ?? [];
    if (actualRules.length !== expectedDimension.rules.length) {
      throw new Error(`Contrato inválido: quality-score.json no coincide con el número de reglas de '${expectedDimension.label}'.`);
    }

    for (let ruleIndex = 0; ruleIndex < expectedDimension.rules.length; ruleIndex += 1) {
      const actualRule = actualRules[ruleIndex] ?? {};
      const expectedRule = expectedDimension.rules[ruleIndex];

      if (String(actualRule.ruleId ?? '') !== expectedRule.ruleId) {
        throw new Error(`Contrato inválido: quality-score.json no coincide con la regla '${expectedRule.ruleId}' de '${expectedDimension.label}'.`);
      }

      if (Number(actualRule.weight) !== expectedRule.weight) {
        throw new Error(`Contrato inválido: quality-score.json no coincide con el peso de '${expectedRule.ruleId}'.`);
      }

      if (expectedRule.score === null) {
        if (actualRule.score !== null) {
          throw new Error(`Contrato inválido: quality-score.json no debe inventar score para '${expectedRule.ruleId}'.`);
        }
      } else if (Number(actualRule.score) !== expectedRule.score) {
        throw new Error(`Contrato inválido: quality-score.json no coincide con el score de '${expectedRule.ruleId}'.`);
      }

      if (String(actualRule.status ?? '') !== String(expectedRule.status ?? '')) {
        throw new Error(`Contrato inválido: quality-score.json no coincide con el estado de '${expectedRule.ruleId}'.`);
      }
    }
  }
}

function assertQuickchartMatchesQualityScore(quickchart, qualityScore) {
  const included = (qualityScore.dimensions ?? []).filter((dimension) => Number.isFinite(dimension.score));
  const radarLabels = quickchart?.data?.labels ?? [];
  const expectedLabels = included.map((dimension) => dimension.label);
  const evaluatedSeries = quickchart?.data?.datasets?.[0]?.data ?? [];
  const targetSeries = quickchart?.data?.datasets?.[1]?.data ?? [];
  const expectedScores = included.map((dimension) => dimension.score);
  const expectedTargets = included.map((dimension) => dimension.target);

  if (!arraysEqual(radarLabels, expectedLabels)) {
    throw new Error('Contrato inválido: quickchart-radar.json no coincide con quality-score.json en el orden de dimensiones.');
  }

  if (!arraysEqual(evaluatedSeries, expectedScores)) {
    throw new Error('Contrato inválido: quickchart-radar.json no coincide con quality-score.json en el dataset Evaluado.');
  }

  if (!arraysEqual(targetSeries, expectedTargets)) {
    throw new Error('Contrato inválido: quickchart-radar.json no coincide con quality-score.json en el dataset Objetivo.');
  }

  if (Boolean(quickchart?.partial) !== Boolean(qualityScore.partial)) {
    throw new Error('Contrato inválido: quickchart-radar.json no coincide con el indicador partial.');
  }

  if (!arraysEqual(quickchart?.omittedDimensions ?? [], (qualityScore.dimensions ?? []).filter((dimension) => !Number.isFinite(dimension.score)).map((dimension) => dimension.label))) {
    throw new Error('Contrato inválido: quickchart-radar.json no coincide con las dimensiones omitidas.');
  }
}

function validateCatalogReferences(catalog) {
  const elementIds = new Set((catalog.elements ?? []).map((element) => element.id));
  const relationshipIds = new Set((catalog.relationships ?? []).map((relationship) => relationship.id));
  const brokenReferences = [];

  for (const object of catalog.diagramObjects ?? []) {
    if (!elementIds.has(object.elementRef)) {
      brokenReferences.push(`diagramObject:${object.id}->${object.elementRef}`);
    }
  }

  for (const connection of catalog.diagramConnections ?? []) {
    if (!relationshipIds.has(connection.relationshipRef)) {
      brokenReferences.push(`diagramConnection:${connection.id}->${connection.relationshipRef}`);
    }
  }

  for (const relationship of catalog.relationships ?? []) {
    if (!elementIds.has(relationship.source)) {
      brokenReferences.push(`relationship:${relationship.id}.source->${relationship.source}`);
    }

    if (!elementIds.has(relationship.target)) {
      brokenReferences.push(`relationship:${relationship.id}.target->${relationship.target}`);
    }
  }

  if (brokenReferences.length > 0) {
    throw new Error(`Contrato inválido: catalog.json contiene referencias rotas (${brokenReferences.join(', ')}).`);
  }
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function flattenChecks(validators) {
  return validators.flatMap((validator) => (validator.checks ?? []).map((check) => ({
    ...check,
    validatorId: validator.id,
    validatorTitle: validator.title,
  })));
}

function getResultLabel({ failCount, warnCount, systemError, incomplete }) {
  if (systemError) {
    return '⚫ NO EVALUABLE';
  }

  if (incomplete) {
    return '🟠 EVALUACIÓN PARCIAL';
  }

  if (failCount > 0) {
    return '🔴 NO CUMPLE';
  }

  if (warnCount > 0) {
    return '🟡 ACEPTABLE CON OBSERVACIONES';
  }

  return '✅ APROBADO';
}

function renderIncompletePanel(isIncomplete) {
  if (!isIncomplete) {
    return [];
  }

  return [
    '> [!CAUTION]',
    '> **EVALUACIÓN PARCIAL**',
    '>',
    '> Hay dimensiones no implementadas y el radar se publica de forma parcial.',
    '',
  ];
}

async function renderDashboardSectionFinal({ validators, complianceText, passCount, warnCount, failCount, totalRules, rulesEvaluated, dslCount, resultLabel }) {
  try {
    const dimensions = buildDimensionSummaries(validators);
    const [complianceUrl, distributionUrl, dimensionsUrl] = await Promise.all([
      createQuickChartUrl(buildComplianceChartConfig({ passCount, warnCount, failCount, totalRules }), { width: 220, height: 160 }),
      createQuickChartUrl(buildDistributionChartConfig({ passCount, warnCount, failCount }), { width: 260, height: 160 }),
      createQuickChartUrl(buildDimensionsChartConfig(dimensions), { width: 300, height: 160 }),
    ]);

    return {
      lines: [
        '<table>',
        '  <thead>',
        '    <tr>',
        '      <th colspan="3" align="left">Calidad del diseño</th>',
        '    </tr>',
        '  </thead>',
        '  <tbody>',
        '    <tr>',
        `      <td><img src="${complianceUrl}" width="220" height="160" alt="Cumplimiento general"></td>`,
        `      <td><img src="${distributionUrl}" width="260" height="160" alt="Distribución de resultados"></td>`,
        `      <td><img src="${dimensionsUrl}" width="300" height="160" alt="Calidad por dimensión"></td>`,
        '    </tr>',
        '  </tbody>',
        '</table>',
        '',
      ],
      systemIssueLines: [],
    };
  } catch (error) {
    return {
      lines: [
        '<table>',
        '  <thead>',
        '    <tr>',
        '      <th colspan="3" align="left">Calidad del diseño</th>',
        '    </tr>',
        '  </thead>',
        '  <tbody>',
        '    <tr>',
        '      <td colspan="3">',
        '```text',
        `Cumplimiento: ${complianceText}`,
        `Resultado: ${resultLabel}`,
        `PASS: ${formatCount(passCount)} · WARN: ${formatCount(warnCount)} · FAIL: ${formatCount(failCount)}`,
        `Reglas evaluadas: ${formatCount(rulesEvaluated)} · DSLs: ${formatCount(dslCount)}`,
        '```',
        '      </td>',
        '    </tr>',
        '  </tbody>',
        '</table>',
        '',
      ],
      systemIssueLines: [
        '## Estado del sistema',
        '',
        '> [!CAUTION]',
        '> **ERROR — No se pudieron generar los gráficos del dashboard**',
        '>',
        `> **Detalle:** ${normalizeInlineText(error?.message ?? 'QuickChart no respondió.')}`,
        '> **Acción:** revisar conectividad hacia QuickChart o usar fallback textual.',
        '',
      ],
    };
  }
}

function buildComplianceChartConfig({ passCount, warnCount, failCount, totalRules }) {
  const safeTotal = Math.max(0, Number(totalRules) || 0);
  const safePass = Math.max(0, Math.min(safeTotal, Number(passCount) || 0));
  const remaining = Math.max(0, safeTotal - safePass);
  const remainingColor = getScoreColor({ failCount, warnCount, totalRules: safeTotal });

  return {
    type: 'doughnut',
    data: {
      labels: ['Cumplimiento', 'Pendiente'],
      datasets: [
        {
          data: [safePass, remaining],
          backgroundColor: ['#22c55e', remaining > 0 ? remainingColor : '#e5e7eb'],
          borderWidth: 0,
        },
      ],
    },
    options: {
      layout: { padding: 4 },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `Cumplimiento ${formatRatio(safePass, safeTotal)}`,
          font: { size: 13 },
        },
      },
      cutout: '70%',
    },
  };
}

function buildDistributionChartConfig({ passCount, warnCount, failCount }) {
  return {
    type: 'bar',
    data: {
      labels: ['PASS', 'WARN', 'FAIL'],
      datasets: [
        {
          label: 'Reglas',
          data: [passCount, warnCount, failCount],
          backgroundColor: ['#22c55e', '#f59e0b', '#ef4444'],
        },
      ],
    },
    options: {
      layout: { padding: 4 },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: 'Reglas',
          font: { size: 13 },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0, font: { size: 10 } },
        },
        x: { ticks: { font: { size: 10 } } },
      },
    },
  };
}

function buildDimensionsChartConfig(dimensions) {
  return {
    type: 'bar',
    data: {
      labels: dimensions.map((dimension) => dimension.label),
      datasets: [
        {
          label: 'Score',
          data: dimensions.map((dimension) => dimension.score),
          backgroundColor: dimensions.map((dimension) => dimension.color),
        },
      ],
    },
    options: {
      indexAxis: 'y',
      layout: { padding: 4 },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: 'Dimensiones',
          font: { size: 13 },
        },
      },
      scales: {
        x: {
          min: 0,
          max: 10,
          ticks: { stepSize: 2, precision: 0, font: { size: 10 } },
        },
        y: {
          ticks: { font: { size: 10 } },
        },
      },
    },
  };
}

function buildDimensionSummaries(validators) {
  const dimensions = [
    { label: 'XML', matches: ({ validator, check }) => validator.dslType === 'archi-consistency' && check.group === 'document' },
    { label: 'Identidad', matches: ({ validator, check }) => validator.dslType === 'archi-consistency' && check.group === 'archiIdentity' },
    { label: 'Estructura', matches: ({ validator, check }) => validator.dslType === 'archi-consistency' && check.group === 'archiStructure' },
    { label: 'Integridad', matches: ({ validator, check }) => validator.dslType === 'archi-consistency' && check.group === 'internalIntegrity' },
    { label: 'Estilo', matches: ({ validator, check }) => validator.dslType === 'archi-style' && check.group !== 'Views' },
    { label: 'Vistas', matches: ({ validator, check }) => validator.dslType === 'archi-style' && check.group === 'Views' },
  ];

  return dimensions.map((dimension) => {
    let passCount = 0;
    let warnCount = 0;
    let failCount = 0;

    for (const validator of validators) {
      for (const check of validator.checks ?? []) {
        if (!dimension.matches({ validator, check })) {
          continue;
        }

        if (check.status === 'PASS') {
          passCount += 1;
        } else if (check.status === 'WARN') {
          warnCount += 1;
        } else if (check.status === 'FAIL') {
          failCount += 1;
        }
      }
    }

    const score = Math.max(0, 10 - warnCount - (failCount * 4));

    return {
      label: dimension.label,
      score,
      passCount,
      warnCount,
      failCount,
      color: getDimensionColor(score, failCount, warnCount),
    };
  });
}

function getScoreColor({ failCount, warnCount, totalRules }) {
  if (totalRules === 0) {
    return '#9ca3af';
  }

  if (failCount > 0) {
    return '#ef4444';
  }

  if (warnCount > 0) {
    return '#f59e0b';
  }

  return '#22c55e';
}

function getDimensionColor(score, failCount, warnCount) {
  if (failCount > 0) {
    return '#ef4444';
  }

  if (warnCount > 0 || Number(score) < 10) {
    return '#f59e0b';
  }

  return '#22c55e';
}

function formatRatio(value, total) {
  const safeValue = Math.max(0, Number(value) || 0);
  const safeTotal = Math.max(0, Number(total) || 0);
  return `${String(safeValue).padStart(2, '0')}/${String(safeTotal).padStart(2, '0')}`;
}

async function createQuickChartUrl(chartConfig, { width = 500, height = 300 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://quickchart.io/chart/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: '4',
        backgroundColor: 'white',
        width,
        height,
        format: 'png',
        devicePixelRatio: 2,
        chart: chartConfig,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`QuickChart request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const url = data.shortUrl ?? data.url;

    if (!url) {
      throw new Error('QuickChart response did not include url.');
    }

    return url;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('QuickChart request timed out after 15 seconds.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function renderWarningPanelFinal(warnChecks) {
  if (warnChecks.length === 0) {
    return [];
  }

  const lines = [
    '> [!WARNING]',
    `> **${warnChecks.length} ${pluralize(warnChecks.length, 'observación', 'observaciones')} ${warnChecks.length === 1 ? 'requiere' : 'requieren'} revisión**`,
    '>',
  ];

  warnChecks.forEach((check, index) => {
    lines.push(...renderIssuePanelEntryFinal(check, 'Elemento', 'Problema', 'Recomendación'));
    if (index < warnChecks.length - 1) {
      lines.push('>');
    }
  });

  lines.push('');
  return lines;
}

function renderCautionPanelFinal(failChecks) {
  if (failChecks.length === 0) {
    return [];
  }

  const lines = [
    '> [!CAUTION]',
    `> **${failChecks.length} ${pluralize(failChecks.length, 'regla bloqueante incumplida', 'reglas bloqueantes incumplidas')}**`,
    '>',
  ];

  failChecks.forEach((check, index) => {
    lines.push(...renderIssuePanelEntryFinal(check, 'Elemento', 'Problema', 'Recomendación'));
    if (index < failChecks.length - 1) {
      lines.push('>');
    }
  });

  lines.push('');
  return lines;
}

function renderTipPanelFinal(validators, passChecks) {
  if (passChecks.length === 0) {
    return [];
  }

  const lines = [
    '> [!TIP]',
    `> **${passChecks.length} ${pluralize(passChecks.length, 'regla cumplida', 'reglas cumplidas')}**`,
    '>',
    '> <details>',
    '> <summary>Ver reglas cumplidas</summary>',
    '>',
  ];

  for (const validator of validators) {
    const validatorPasses = (validator.checks ?? []).filter((check) => check.status === 'PASS');
    if (validatorPasses.length === 0) {
      continue;
    }

    lines.push(`> ### ${validator.title ?? validator.id ?? 'Reglas'}`);
    lines.push('>');

    for (const check of validatorPasses) {
      lines.push(`> - \`${escapeInlineCode(check.id)}\` — ${formatPassDescription(check.description ?? check.detail ?? 'Cumple.')}`);
    }

    lines.push('>');
  }

  lines.push('> </details>', '');
  return lines;
}

function renderIssuePanelEntryFinal(check, elementLabel, problemLabel, recommendationLabel) {
  const lines = [`> **Regla:** \`${escapeInlineCode(check.id)}\``];
  lines.push(`> **Ubicación:** \`${escapeInlineCode(check.group ?? 'General')}\``);

  const element = getMeaningfulDetail(check.detail);
  if (element) {
    lines.push(`> **${elementLabel}:** \`${escapeInlineCode(element)}\``);
  }

  lines.push(`> **${problemLabel}:** ${normalizeInlineText(check.message ?? 'Revisar el hallazgo reportado.')}`);
  lines.push(`> **${recommendationLabel}:** ${normalizeInlineText(suggestAction(check))}`);

  return lines;
}

function renderSystemErrorSummary(response) {
  const contractInconsistency = /Contrato inconsistente/i.test(String(response.error ?? ''));
  const title = contractInconsistency ? 'ERROR — Contrato inconsistente' : 'ERROR — No se pudo completar la validación';
  return [
    '# Calidad del diseño',
    '',
    '## Estado del sistema',
    '',
    '> [!CAUTION]',
    `> **${title}**`,
    '>',
    contractInconsistency ? '> La validación encontró una inconsistencia contractual.' : '> El motor no pudo completar la validación.',
    `> **Detalle:** ${normalizeInlineText(response.error ?? 'Error desconocido.')}`,
    '> **Acción:** Revisar el manifiesto, el artefacto de entrada y la configuración del workflow.',
  ];
}

function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural;
}

function formatCount(value) {
  if (Number(value) > 99) {
    return '99+';
  }

  return String(Math.max(0, Number(value) || 0)).padStart(2, '0');
}

function formatScore(value) {
  const safeValue = Math.max(0, Math.min(10, Number(value) || 0));
  return `${String(safeValue).padStart(2, '0')}/10`;
}

function escapeInlineCode(value) {
  return String(value ?? '').replace(/`/g, '\\`').trim();
}

function escapeMarkdownText(value) {
  return String(value ?? '').replace(/\r?\n+/g, ' ').trim();
}

function normalizeInlineText(value) {
  return escapeMarkdownText(value);
}

function getMeaningfulDetail(value) {
  const text = normalizeInlineText(value);
  if (!text) {
    return '';
  }

  const normalized = text.toLowerCase();
  const genericValues = new Set([
    'binary',
    'missing-context',
    'missing-rule',
    'n/a',
    'na',
    'pass',
    'sin coincidencias',
    'unsupported',
    'xml',
    'utf-8',
    'utf-8-bom',
  ]);

  if (genericValues.has(normalized)) {
    return '';
  }

  if (/^no se (encontró|encontro|definió|definio)/i.test(text)) {
    return '';
  }

  return text;
}

function stripTrailingPeriod(value) {
  return String(value ?? '').replace(/\.+$/, '');
}

function formatPassDescription(value) {
  const text = stripTrailingPeriod(value)
    .replace(/^Verifica que\s+/i, '')
    .replace(/^Valida que\s+/i, '')
    .replace(/\bpueda\b/gi, 'puede')
    .replace(/\bcorresponda\b/gi, 'corresponde')
    .replace(/\besté\b/gi, 'está')
    .replace(/\bexistan\b/gi, 'Existen')
    .replace(/\bexista\b/gi, 'existe')
    .replace(/\bcontenga\b/gi, 'contiene')
    .replace(/\bapunten\b/gi, 'apuntan')
    .replace(/\btenga\b/gi, 'tiene')
    .replace(/\bsea\b/gi, 'es')
    .replace(/\bsean\b/gi, 'son')
    .replace(/\bcomiencen\b/gi, 'comienzan');

  if (text.length === 0) {
    return text;
  }

  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

function suggestAction(check) {
  if (check.status === 'WARN') {
    if (/may[uú]scula/i.test(String(check.message ?? ''))) {
      return 'Renombrar el elemento para que inicie con mayúscula.';
    }

    return 'Revisar la convención y ajustar el elemento.';
  }

  if (check.status === 'FAIL') {
    return check.message ?? 'Bloquea el cumplimiento y requiere corrección.';
  }

  return 'Sin acción.';
}
