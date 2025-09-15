/* 
  Tests for CodeRabbit configuration.
  Framework: Jest (if available). The tests use standard Jest APIs: describe, it/test, expect.
  If Jest isn't present, many runners (e.g., Vitest) are API-compatible; otherwise adapt as needed.
*/

const fs = require('fs');
const path = require('path');

let yamlParser = null;
try {
  // Prefer js-yaml if the project has it
  yamlParser = require('js-yaml');
} catch (_) {
  // Fallback: minimal ad-hoc parser for this specific structure
  yamlParser = {
    // Only supports keys: language (string), reviews.goals (array of strings)
    load: (text) => {
      const lines = text.split(/\r?\n/);
      const doc = {};
      let i = 0;
      // parse top-level language
      const langLine = lines.find(l => /^\s*language\s*:/.test(l));
      if (langLine) {
        const m = langLine.match(/language\s*:\s*["']?([A-Za-z-]+)["']?/);
        if (m) doc.language = m[1];
      }
      // parse reviews.goals
      let goals = [];
      let inGoals = false;
      for (i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*reviews\s*:\s*$/.test(line)) {
          // keep scanning
          continue;
        }
        if (/^\s*goals\s*:\s*$/.test(line)) {
          inGoals = true;
          continue;
        }
        if (inGoals) {
          const item = line.match(/^\s*-\s*(.+?)\s*$/);
          if (item) {
            goals.push(item[1].replace(/^["']|["']$/g, ''));
            continue;
          } else if (line.trim().length === 0) {
            continue;
          } else if (/^\S/.test(line)) {
            // new top-level encountered, stop goals
            inGoals = false;
          }
        }
      }
      if (goals.length) {
        doc.reviews = { goals };
      }
      return doc;
    }
  };
}

function loadConfigFile() {
  // Look for common CodeRabbit config filenames, else fall back to fixture in repo root if present.
  const candidates = [
    '.coderabbit.yml',
    '.coderabbit.yaml',
    'coderabbit.yml',
    'coderabbit.yaml'
  ];
  let found = null;
  for (const f of candidates) {
    const p = path.resolve(process.cwd(), f);
    if (fs.existsSync(p)) { found = p; break; }
  }
  if (!found) {
    // As a fallback for this PR context, attempt to read from tests/fixtures/coderabbit.yml if present.
    const fixture = path.resolve(process.cwd(), 'tests/fixtures/coderabbit.yml');
    if (fs.existsSync(fixture)) {
      found = fixture;
    }
  }
  if (!found) {
    throw new Error("CodeRabbit config file not found (.coderabbit.yml/.yaml)");
  }
  const raw = fs.readFileSync(found, 'utf8');
  return { raw, path: found };
}

function validateSchema(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') {
    errors.push('Document must be an object.');
    return errors;
  }
  // language
  if (!('language' in doc)) errors.push('Missing "language" property.');
  else if (typeof doc.language !== 'string' || doc.language.trim() === '') errors.push('"language" must be a non-empty string.');
  // reviews.goals
  if (!doc.reviews || typeof doc.reviews !== 'object') {
    errors.push('Missing "reviews" section.');
  } else if (!Array.isArray(doc.reviews.goals)) {
    errors.push('"reviews.goals" must be an array.');
  } else {
    if (doc.reviews.goals.length === 0) errors.push('"reviews.goals" should include at least one goal.');
    // no duplicates
    const set = new Set(doc.reviews.goals);
    if (set.size !== doc.reviews.goals.length) errors.push('"reviews.goals" contains duplicate entries.');
    // ensure all are non-empty strings
    const invalid = doc.reviews.goals.filter(x => typeof x !== 'string' || x.trim() === '');
    if (invalid.length) errors.push('"reviews.goals" contains empty or non-string entries.');
  }
  return errors;
}

describe('CodeRabbit configuration', () => {
  it('loads and parses the YAML file without errors', () => {
    const { raw, path: p } = loadConfigFile();
    expect(raw).toBeTruthy();
    // parsing should not throw even with fallback parser
    const doc = yamlParser.load(raw);
    expect(typeof doc).toBe('object');
    // at least language or reviews should exist
    expect(doc.language || (doc.reviews && doc.reviews.goals)).toBeTruthy();
  });

  it('matches expected language and goals per PR diff', () => {
    const expectedLanguage = 'en-US';
    const expectedGoals = ['Check code quality', 'Spot bugs', 'Suggest improvements'];
    const { raw } = loadConfigFile();
    const doc = yamlParser.load(raw);

    // Validate language
    expect(doc.language).toBe(expectedLanguage);

    // Validate goals content and order
    expect(doc.reviews).toBeTruthy();
    expect(Array.isArray(doc.reviews.goals)).toBe(true);
    expect(doc.reviews.goals).toHaveLength(3);
    expect(doc.reviews.goals).toEqual(expectedGoals);
  });

  it('conforms to the minimal schema (language + reviews.goals)', () => {
    const { raw } = loadConfigFile();
    const doc = yamlParser.load(raw);
    const errors = validateSchema(doc);
    expect(errors).toEqual([]);
  });

  it('rejects configs with missing language', () => {
    const bad = `
reviews:
  goals:
    - Check code quality
    - Spot bugs
    - Suggest improvements
`;
    const doc = yamlParser.load(bad);
    const errors = validateSchema(doc);
    expect(errors).toContain('Missing "language" property.');
  });

  it('rejects configs with empty goals or duplicates', () => {
    const bad = `
language: "en-US"
reviews:
  goals:
    - Check code quality
    - 
    - Check code quality
`;
    const doc = yamlParser.load(bad);
    const errors = validateSchema(doc);
    expect(errors).toContain('"reviews.goals" contains duplicate entries.');
    expect(errors).toContain('"reviews.goals" contains empty or non-string entries.');
  });

  it('accepts alternative quoting/spacing for language', () => {
    const variant = `
language: en-US
reviews:
  goals:
    - "Check code quality"
    - 'Spot bugs'
    - Suggest improvements
`;
    const doc = yamlParser.load(variant);
    // Fallback parser tolerates unquoted, quoted with " or '
    expect(doc.language).toBe('en-US');
    const errors = validateSchema(doc);
    expect(errors).toEqual([]);
  });

  it('fails gracefully when YAML file is not present', () => {
    // Temporarily mask fs.existsSync to simulate missing file
    const existsOrig = fs.existsSync;
    try {
      fs.existsSync = (p) => false;
      expect(() => loadConfigFile()).toThrow(/not found/i);
    } finally {
      fs.existsSync = existsOrig;
    }
  });
});