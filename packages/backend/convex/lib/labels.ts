/**
 * Shared label utilities for mapping annotation ratings to binary pass/fail.
 */

const PASS_RATINGS = new Set(["pass", "great", "good_enough"]);

export function toBinaryLabel(rating: string): "pass" | "fail" {
  return PASS_RATINGS.has(rating) ? "pass" : "fail";
}
