'use strict';

/**
 * 의존성 없는 초소형 JSON Schema 검증기.
 *
 * 이 프로젝트의 스키마(schema/*.json)가 사용하는 키워드만 지원한다:
 *   $ref(문서 내부 포인터), type, enum, const, pattern,
 *   minLength, maxLength, minimum, maximum,
 *   required, properties, additionalProperties,
 *   items, minItems, maxItems, uniqueItems
 *
 * npm 설치 없이 오프라인에서 바로 돌리기 위한 선택이며,
 * 스키마에 새 키워드를 쓰려면 여기에 구현을 추가해야 한다.
 */

const SUPPORTED = new Set([
  '$schema', '$id', 'title', 'description', 'default', 'examples', '$defs',
  '$ref', 'type', 'enum', 'const', 'pattern', 'minLength', 'maxLength',
  'minimum', 'maximum', 'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems'
]);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  return typeof value; // string | boolean | object
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

function resolvePointer(root, ref) {
  if (!ref.startsWith('#')) {
    throw new Error(`외부 $ref 는 지원하지 않습니다: ${ref}`);
  }
  const parts = ref.slice(1).split('/').filter(Boolean);
  let node = root;
  for (const rawPart of parts) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    node = node && node[part];
    if (node === undefined) throw new Error(`$ref 를 찾을 수 없습니다: ${ref}`);
  }
  return node;
}

function unsupportedKeywords(schema) {
  return Object.keys(schema).filter((k) => !SUPPORTED.has(k));
}

function check(schema, value, path, root, errors) {
  if (schema.$ref) {
    check(resolvePointer(root, schema.$ref), value, path, root, errors);
    return;
  }

  const add = (message) => errors.push({ path: path || '(root)', message });

  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((t) => matchesType(value, t))) {
      add(`타입이 ${expected.join(' | ')} 이어야 하는데 ${typeOf(value)} 입니다.`);
      return; // 타입이 틀리면 이후 검사는 의미가 없다.
    }
  }

  if (schema.enum !== undefined) {
    const ok = schema.enum.some((c) => JSON.stringify(c) === JSON.stringify(value));
    if (!ok) add(`허용된 값이 아닙니다. (허용: ${schema.enum.join(', ')})`);
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    add(`값이 ${JSON.stringify(schema.const)} 이어야 합니다.`);
  }

  const kind = typeOf(value);

  if (kind === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      add(`문자열 길이가 ${schema.minLength} 이상이어야 합니다.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      add(`문자열 길이가 ${schema.maxLength} 이하여야 합니다.`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      add(`형식이 올바르지 않습니다. (정규식: ${schema.pattern}, 값: "${value}")`);
    }
  }

  if (kind === 'number' || kind === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      add(`${schema.minimum} 이상이어야 합니다. (값: ${value})`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      add(`${schema.maximum} 이하여야 합니다. (값: ${value})`);
    }
  }

  if (kind === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      add(`항목이 ${schema.minItems}개 이상이어야 합니다.`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      add(`항목이 ${schema.maxItems}개 이하여야 합니다.`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      value.forEach((item) => seen.add(JSON.stringify(item)));
      if (seen.size !== value.length) add('배열에 중복된 값이 있습니다.');
    }
    if (schema.items) {
      value.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, root, errors));
    }
  }

  if (kind === 'object') {
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        add(`필수 항목 "${key}" 이(가) 없습니다.`);
      }
    }
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (properties[key]) {
        check(properties[key], child, childPath, root, errors);
      } else if (schema.additionalProperties === false) {
        add(`정의되지 않은 키 "${key}" 가 있습니다. (스키마에 없는 필드)`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        check(schema.additionalProperties, child, childPath, root, errors);
      }
    }
  }
}

/**
 * @returns {{path: string, message: string}[]} 비어 있으면 통과.
 */
function validate(schema, data) {
  const unsupported = unsupportedKeywords(schema);
  if (unsupported.length) {
    return [{
      path: '(schema)',
      message: `이 검증기가 지원하지 않는 키워드: ${unsupported.join(', ')} — scripts/lib/jsonschema.js 에 구현을 추가하세요.`
    }];
  }
  const errors = [];
  check(schema, data, '', schema, errors);
  return errors;
}

module.exports = { validate };
