import { z } from 'zod';

const ManifestArtifactSchema = z.object({
  type: z.string().min(1),
  tool: z.string().min(1),
  source: z.object({
    path: z.string().min(1),
    mode: z.string().min(1),
  }).passthrough(),
}).passthrough();

const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifact: ManifestArtifactSchema,
  orderOfExecution: z.array(z.string().min(1)).default([]),
}).passthrough();

const ComponentPatternSchema = z.object({
  value: z.string().min(1),
  description: z.string().optional(),
}).passthrough();

const ComponentSelectorSchema = z.object({
  query: z.string().min(1),
  description: z.string().optional(),
  language: z.string().optional(),
}).passthrough();

const ComponentsSchema = z.object({
  patterns: z.record(ComponentPatternSchema).optional(),
  selectors: z.record(ComponentSelectorSchema).optional(),
  lists: z.record(z.array(z.string())).optional(),
}).passthrough();

const MetadataSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  purpose: z.string().optional(),
}).passthrough();

const TargetSchema = z.object({
  id: z.string().optional(),
  tool: z.string().optional(),
  format: z.string().optional(),
  dialect: z.string().optional(),
  path: z.string().optional(),
  mode: z.string().optional(),
}).passthrough();

const DefaultsSchema = z.object({
  severity: z.string().optional(),
  selectorLanguage: z.string().optional(),
  field: z.string().optional(),
}).passthrough();

const RuleDefinitionSchema = z.object({
  severity: z.enum(['error', 'warning']).default('error'),
  description: z.string().optional(),
  failureMessage: z.string().optional(),
  validate: z.object({}).passthrough(),
}).passthrough();

const ConsistencyDslSchema = z.object({
  archi_consistency_dsl: z.string().min(1),
  metadata: MetadataSchema.optional(),
  consistencyGuide: z.record(z.array(z.string())).default({}),
  rules: z.record(RuleDefinitionSchema).default({}),
}).passthrough();

const StyleDslSchema = z.object({
  archi_style_dsl: z.string().min(1),
  metadata: MetadataSchema.optional(),
  styleGuide: z.record(z.array(z.string())).default({}),
  rules: z.record(RuleDefinitionSchema).default({}),
}).passthrough();

const DslSchema = z.union([ConsistencyDslSchema, StyleDslSchema]);

export function validateManifestData(data, sourcePath) {
  return validateSchema('manifest', ManifestSchema, data, sourcePath);
}

export function validateDslData(data, sourcePath) {
  return validateSchema('dsl', DslSchema, data, sourcePath, normalizeDslData);
}

function validateSchema(label, schema, data, sourcePath, transform) {
  const result = schema.safeParse(data);
  if (result.success) {
    return transform ? transform(result.data) : result.data;
  }

  const details = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
    .join('; ');

  throw new Error(`Esquema inválido en ${label}${sourcePath ? ` (${sourcePath})` : ''}: ${details}`);
}

function normalizeDslData(dsl) {
  const metadata = dsl.metadata ?? {};
  return {
    ...dsl,
    id: dsl.id ?? metadata.id,
    title: dsl.title ?? metadata.title,
    author: dsl.author ?? metadata.author,
    description: dsl.description ?? metadata.description,
    purpose: dsl.purpose ?? metadata.purpose,
    dslType: dsl.archi_consistency_dsl ? 'archi-consistency' : 'archi-style',
  };
}
