const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

function validateIdentifier(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid identifier: must be a non-empty string');
  }
  if (!IDENTIFIER_REGEX.test(name)) {
    throw new Error(`Invalid identifier: "${name}"`);
  }
  return name;
}

function quoteIdentifier(name) {
  validateIdentifier(name);
  return '"' + name.replace(/"/g, '""') + '"';
}

module.exports = { validateIdentifier, quoteIdentifier };
