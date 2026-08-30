import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNumericExpression } from '../src/core/mathExpression.js';

test('resuelve operaciones básicas y precedencia', () => {
  assert.equal(evaluateNumericExpression('12+4-2'), 14);
  assert.equal(evaluateNumericExpression('5*6'), 30);
  assert.equal(evaluateNumericExpression('24/2'), 12);
  assert.equal(evaluateNumericExpression('(10+5)*2'), 30);
});

test('acepta coma decimal', () => {
  assert.equal(evaluateNumericExpression('12,5 + 2,5'), 15);
});

test('acepta negativos unarios', () => {
  assert.equal(evaluateNumericExpression('-5 + 8'), 3);
});

test('rechaza división entre cero y caracteres peligrosos', () => {
  assert.throws(() => evaluateNumericExpression('10/0'));
  assert.throws(() => evaluateNumericExpression('alert(1)'));
  assert.throws(() => evaluateNumericExpression('2 ** 3'));
});
