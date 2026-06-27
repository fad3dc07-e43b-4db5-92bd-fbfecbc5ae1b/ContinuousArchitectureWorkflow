import { z } from 'zod';

const ManifestRuleSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  ruleFile: z.string().min(1),
}).passthrough();

const ManifestSchema = z.object({
  rules: z.array(ManifestRuleSchema).default([]),
}).passthrough();

const PathCheckSchema = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  type: z.literal('path'),
  path: z.string().min(1),
  kind: z.enum(['file', 'dir']),
  failureMessage: z.string().optional(),
}).passthrough();

const SingleVisibleFileSchema = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  type: z.literal('single-visible-file'),
  path: z.string().min(1),
  name: z.string().min(1),
  failureMessage: z.string().optional(),
}).passthrough();

const FileNotEmptySchema = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  type: z.literal('file-not-empty'),
  path: z.string().min(1),
  failureMessage: z.string().optional(),
}).passthrough();

const XmlRootSchema = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  type: z.literal('xml-root'),
  path: z.string().min(1),
  root: z.string().min(1),
  failureMessage: z.string().optional(),
}).passthrough();

const TextContainsSchema = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  type: z.literal('text-contains'),
  path: z.string().min(1),
  text: z.string().min(1),
  failureMessage: z.string().optional(),
}).passthrough();

const XmlNameRegexSchema = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  examples: z.array(z.string()).optional(),
  type: z.literal('xml-name-regex'),
  path: z.string().min(1),
  selector: z.string().optional(),
  pattern: z.string().min(1),
  failureMessage: z.string().optional(),
}).passthrough();

const XmlNameNotContainsSchema = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  examples: z.array(z.string()).optional(),
  type: z.literal('xml-name-not-contains'),
  path: z.string().min(1),
  selector: z.string().optional(),
  forbidden: z.array(z.string()).default([]),
  failureMessage: z.string().optional(),
}).passthrough();

const RepositoryNameSchema = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  type: z.literal('repository-name'),
  pattern: z.string().min(1),
  failureMessage: z.string().optional(),
}).passthrough();

const CheckSchema = z.discriminatedUnion('type', [
  RepositoryNameSchema,
  PathCheckSchema,
  SingleVisibleFileSchema,
  FileNotEmptySchema,
  XmlRootSchema,
  TextContainsSchema,
  XmlNameRegexSchema,
  XmlNameNotContainsSchema,
]);

const RuleSetSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  tool: z.string().optional(),
  format: z.string().optional(),
  dialect: z.string().optional(),
  target: z.object({
    path: z.string().optional(),
    mode: z.string().optional(),
  }).passthrough().optional(),
  description: z.string().optional(),
  purpose: z.string().optional(),
  scope: z.string().optional(),
  checks: z.array(CheckSchema).default([]),
}).passthrough();

export function validateManifestData(data, sourcePath) {
  return validateSchema('manifest', ManifestSchema, data, sourcePath);
}

export function validateRuleSetData(data, sourcePath) {
  return validateSchema('ruleset', RuleSetSchema, data, sourcePath);
}

function validateSchema(label, schema, data, sourcePath) {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }

  const details = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
    .join('; ');

  throw new Error(`Esquema inválido en ${label}${sourcePath ? ` (${sourcePath})` : ''}: ${details}`);
}
