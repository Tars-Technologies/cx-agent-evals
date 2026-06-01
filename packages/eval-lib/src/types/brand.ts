/**
 * Branded type utility for creating nominal types in TypeScript's structural type system.
 * Uses unique symbol for stronger nominal typing than string-literal brands.
 *
 * Usage:
 *   type DocumentId = Brand<"DocumentId", string>;
 *   const docId = "test.md" as DocumentId;
 */
declare const __brand: unique symbol

export type Brand<K extends string, T> = T & { readonly [__brand]: K }
