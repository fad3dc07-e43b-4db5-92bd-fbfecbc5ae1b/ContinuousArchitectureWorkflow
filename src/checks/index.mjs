import { evaluateFileNotEmptyCheck } from './file-not-empty.mjs';
import { evaluatePathCheck } from './path.mjs';
import { evaluateRepositoryName } from './repository-name.mjs';
import { evaluateSingleVisibleFileCheck } from './single-visible-file.mjs';
import { evaluateTextContainsCheck } from './text-contains.mjs';
import { evaluateXmlNameNotContainsCheck } from './xml-name-not-contains.mjs';
import { evaluateXmlNameRegexCheck } from './xml-name-regex.mjs';
import { evaluateXmlRootCheck } from './xml-root.mjs';

export const CHECK_RULES = [
  { type: 'repository-name', target: 'repository', evaluate: evaluateRepositoryName },
  { type: 'path', target: 'filesystem', evaluate: evaluatePathCheck },
  { type: 'single-visible-file', target: 'filesystem', evaluate: evaluateSingleVisibleFileCheck },
  { type: 'file-not-empty', target: 'filesystem', evaluate: evaluateFileNotEmptyCheck },
  { type: 'xml-root', target: 'xml', evaluate: evaluateXmlRootCheck },
  { type: 'text-contains', target: 'text', evaluate: evaluateTextContainsCheck },
  { type: 'xml-name-regex', target: 'xml', evaluate: evaluateXmlNameRegexCheck },
  { type: 'xml-name-not-contains', target: 'xml', evaluate: evaluateXmlNameNotContainsCheck },
];

export function getCheckRule(type) {
  return CHECK_RULES.find((rule) => rule.type === type);
}
