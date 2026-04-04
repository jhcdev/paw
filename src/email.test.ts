import assert from "node:assert/strict";
import test from "node:test";

import { isValidEmail } from "./email.js";

test("accepts practical valid email addresses", () => {
  const validEmails = [
    "user@example.com",
    "first.last@example.co.uk",
    "user+tag@example.io",
    "user_name-123@example-domain.com",
  ];

  for (const email of validEmails) {
    assert.equal(isValidEmail(email), true, `Expected ${email} to be valid`);
  }
});

test("rejects invalid email addresses", () => {
  const invalidEmails = [
    "",
    "plainaddress",
    "user@",
    "@example.com",
    "user..name@example.com",
    ".user@example.com",
    "user.@example.com",
    "user@example",
    "user@-example.com",
    "user@example-.com",
    "user@exam_ple.com",
    " user@example.com ",
  ];

  for (const email of invalidEmails) {
    assert.equal(isValidEmail(email), false, `Expected ${email} to be invalid`);
  }
});

test("rejects overlong email parts", () => {
  const overlongLocalPart = `${"a".repeat(65)}@example.com`;
  const overlongAddress = `${"a".repeat(64)}@${"b".repeat(185)}.com`;

  assert.equal(isValidEmail(overlongLocalPart), false);
  assert.equal(isValidEmail(overlongAddress), false);
});
