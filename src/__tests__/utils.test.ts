import test from "node:test";
import assert from "node:assert/strict";
import { add, addArray, addSafe } from "../utils.js";

test("add returns the sum of two valid numbers", () => {
  assert.equal(add(5, 3), 8);
});

test("add throws for non-finite inputs", () => {
  assert.throws(() => add(Number.NaN, 1), /finite number/i);
  assert.throws(() => add(Number.POSITIVE_INFINITY, 1), /finite number/i);
});

test("add throws when the result is outside safe integer bounds", () => {
  assert.throws(() => add(Number.MAX_SAFE_INTEGER, 1), /MAX_SAFE_INTEGER bounds/i);
});

test("addSafe returns Ok for valid inputs", () => {
  const result = addSafe(10, 2);
  assert.deepEqual(result, { ok: true, value: 12 });
});

test("addSafe returns Err for invalid input types", () => {
  const stringResult = addSafe("4", 2);
  assert.equal(stringResult.ok, false);
  if (!stringResult.ok) {
    assert.match(stringResult.error, /expected a number/i);
  }

  const nullResult = addSafe(null, 2);
  assert.equal(nullResult.ok, false);
  if (!nullResult.ok) {
    assert.match(nullResult.error, /expected a number/i);
  }

  const undefinedResult = addSafe(undefined, 2);
  assert.equal(undefinedResult.ok, false);
  if (!undefinedResult.ok) {
    assert.match(undefinedResult.error, /expected a number/i);
  }
});

test("addSafe returns Err for NaN, Infinity, and overflow", () => {
  const nanResult = addSafe(Number.NaN, 1);
  assert.equal(nanResult.ok, false);
  if (!nanResult.ok) {
    assert.match(nanResult.error, /finite number/i);
  }

  const infinityResult = addSafe(Number.NEGATIVE_INFINITY, 1);
  assert.equal(infinityResult.ok, false);
  if (!infinityResult.ok) {
    assert.match(infinityResult.error, /finite number/i);
  }

  const overflowResult = addSafe(Number.MAX_SAFE_INTEGER, 1);
  assert.equal(overflowResult.ok, false);
  if (!overflowResult.ok) {
    assert.match(overflowResult.error, /MAX_SAFE_INTEGER bounds/i);
  }
});

test("addArray sums arrays and handles empty input", () => {
  assert.equal(addArray([1, 2, 3, 4]), 10);
  assert.equal(addArray([]), 0);
});

test("addArray rejects invalid elements and mixed arrays", () => {
  assert.throws(() => addArray([1, Number.NaN]), /finite number/i);
  assert.throws(() => addArray([1, Number.POSITIVE_INFINITY]), /finite number/i);
  assert.throws(() => addArray([1, "2" as unknown as number, 3]), /expected a number/i);
});

test("addArray throws on overflow scenarios", () => {
  assert.throws(() => addArray([Number.MAX_SAFE_INTEGER, 1]), /MAX_SAFE_INTEGER bounds/i);
});
