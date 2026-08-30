// Smart Inventory V2 - motor seguro para campos numéricos.
// Permite +, -, *, /, paréntesis, punto y coma decimal.
// No usa eval() ni Function().

export function evaluateNumericExpression(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Número inválido');
    return input;
  }

  const source = String(input ?? '').trim().replace(/,/g, '.');
  if (!source) return 0;

  if (!/^[0-9+\-*/().\s]+$/.test(source)) {
    throw new Error('La expresión contiene caracteres no permitidos');
  }

  const tokens = tokenize(source);
  let index = 0;

  function peek() {
    return tokens[index] ?? null;
  }

  function consume(type) {
    const token = peek();
    if (!token || token.type !== type) {
      throw new Error('Expresión matemática inválida');
    }
    index += 1;
    return token;
  }

  function parseExpression() {
    let value = parseTerm();
    while (peek()?.type === '+' || peek()?.type === '-') {
      const operator = peek().type;
      index += 1;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm() {
    let value = parseUnary();
    while (peek()?.type === '*' || peek()?.type === '/') {
      const operator = peek().type;
      index += 1;
      const right = parseUnary();
      if (operator === '/' && right === 0) {
        throw new Error('No se puede dividir entre cero');
      }
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }

  function parseUnary() {
    if (peek()?.type === '+') {
      index += 1;
      return parseUnary();
    }
    if (peek()?.type === '-') {
      index += 1;
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();
    if (!token) throw new Error('Expresión matemática incompleta');

    if (token.type === 'number') {
      index += 1;
      return token.value;
    }

    if (token.type === '(') {
      index += 1;
      const value = parseExpression();
      consume(')');
      return value;
    }

    throw new Error('Expresión matemática inválida');
  }

  const result = parseExpression();
  if (index !== tokens.length || !Number.isFinite(result)) {
    throw new Error('Expresión matemática inválida');
  }

  return Math.round((result + Number.EPSILON) * 1e8) / 1e8;
}

function tokenize(source) {
  const tokens = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i];

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if ('+-*/()'.includes(char)) {
      tokens.push({ type: char });
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let raw = '';
      let dots = 0;

      while (i < source.length && /[0-9.]/.test(source[i])) {
        if (source[i] === '.') dots += 1;
        if (dots > 1) throw new Error('Número inválido');
        raw += source[i];
        i += 1;
      }

      if (raw === '.') throw new Error('Número inválido');
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error('Número inválido');
      tokens.push({ type: 'number', value });
      continue;
    }

    throw new Error('Carácter no permitido');
  }

  return tokens;
}
