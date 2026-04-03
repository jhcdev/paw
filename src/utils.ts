import { z } from "zod";
import type { Result } from "./types.js";

function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

const finiteNumberSchema = z
  .custom<number>((value) => typeof value === "number", {
    message: "Expected a number.",
  })
  .refine((value) => Number.isFinite(value), {
    message: "Expected a finite number.",
  });

const numberArraySchema = z.array(finiteNumberSchema);

function ensureSafeSum(sum: number): number {
  if (!Number.isSafeInteger(sum)) {
    throw new Error("Sum exceeds Number.MAX_SAFE_INTEGER bounds.");
  }
  return sum;
}

export function add(a: number, b: number): number {
  const left = finiteNumberSchema.parse(a);
  const right = finiteNumberSchema.parse(b);
  return ensureSafeSum(left + right);
}

export function addSafe(a: unknown, b: unknown): Result<number, string> {
  const left = finiteNumberSchema.safeParse(a);
  if (!left.success) {
    return Err(left.error.issues[0]?.message ?? "Invalid first operand.");
  }

  const right = finiteNumberSchema.safeParse(b);
  if (!right.success) {
    return Err(right.error.issues[0]?.message ?? "Invalid second operand.");
  }

  try {
    return Ok(add(left.data, right.data));
  } catch (error) {
    return Err(error instanceof Error ? error.message : "Unable to add values.");
  }
}

export function addArray(numbers: number[]): number {
  const values = numberArraySchema.parse(numbers);
  let total = 0;

  for (const value of values) {
    total = add(total, value);
  }

  return total;
}

export type { Result } from "./types.js";
