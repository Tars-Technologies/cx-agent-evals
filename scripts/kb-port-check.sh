#!/usr/bin/env bash
#
# kb-port-check.sh — verifies the KB module (convex/kb/ + eval-lib) is portable.
#
# Implements the acceptance test from
#   .idea/feature/kb_management/Sub-Pages/port_readiness.md §4
# plus a cross-domain reference check and a table-closure check.
#
# The KB module is portable iff a clean Convex project can take
# convex/lib/ + convex/config.ts + convex/env.ts + convex/schemas/kb.schema.ts
# + convex/kb/ and run. Each check below guards one way that property can break.
#
# Exit code: 0 if all applicable checks pass, 1 otherwise.
# Checks that require not-yet-integrated branches (e.g. the schema split) are
# SKIPPED with a note rather than failing, so this can run on any branch.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KB="$ROOT/packages/backend/convex/kb"
SCHEMAS="$ROOT/packages/backend/convex/schemas"
EVAL="$ROOT/packages/eval-lib/src"

fail=0
pass() { printf '  \033[32m✅ PASS\033[0m  %s\n' "$1"; }
skip() { printf '  \033[33m⚠️  SKIP\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31m❌ FAIL\033[0m  %s\n' "$1"; fail=1; }

echo "kb-port-check — KB module portability gate"
echo "==========================================="

# Prerequisite: the folder move (kb-port-4) must be present.
if [ ! -d "$KB" ]; then
  echo "  ❌ $KB not found — needs kb-port-4 (folder move) integrated."
  exit 1
fi

# Tables defined in the portable schema surface (kb + shared). Computed once;
# used by checks 6 and 7. Comments are stripped so a v.id("agents") mentioned
# inside an explanatory comment is not mistaken for a real field.
kb_self=""
if [ -d "$SCHEMAS" ]; then
  kb_self=$(sed 's@//.*@@' "$SCHEMAS/kb.schema.ts" "$SCHEMAS/shared.schema.ts" 2>/dev/null \
    | grep -oE '^[[:space:]]*[a-zA-Z]+: defineTable' \
    | grep -oE '[a-zA-Z]+' | grep -v defineTable | sort -u)
fi

# ── Check 1 · No Clerk SDK in the KB module ────────────────────────────────
# Clerk is CXA-specific auth; the target app supplies its own. The function
# name getByClerkId is a clerk-id *lookup*, not an SDK use — \b excludes it
# ("ClerkId" has no word boundary after "Clerk").
echo
echo "[1] No Clerk SDK references (Clerk\\b) in kb/ + eval-lib"
hits=$(grep -rEn "Clerk\b" "$KB" "$EVAL" 2>/dev/null || true)
if [ -n "$hits" ]; then bad "Clerk references found:"; echo "$hits" | sed 's/^/        /'
else pass "none"; fi

# ── Check 2 · No direct process.env reads in convex/kb/ ────────────────────
# Env must flow through convex/config.ts (backendConfig), never process.env.
# Scoped to kb/ only: eval-lib legitimately uses `options.apiKey ?? process.env.X`
# key fallbacks (it ports as a standalone npm package where env fallback is the
# normal pattern). The portability requirement is that the Convex backend uses
# backendConfig — not that the library forbids env fallbacks.
#
# Exempt: Convex-platform system vars (CONVEX_SITE_URL, CONVEX_CLOUD_URL) are
# auto-injected on every deployment — they are not consumer-set config, so the
# "declare it in the seam" rule does not apply. Reading them directly is fine.
echo
echo "[2] No process.env in kb/ (eval-lib + Convex platform vars excluded)"
PLATFORM_ENV='process\.env\.(CONVEX_SITE_URL|CONVEX_CLOUD_URL)\b'
hits=$(grep -rEn "process\.env" "$KB" 2>/dev/null | grep -vE "$PLATFORM_ENV" || true)
if [ -n "$hits" ]; then bad "process.env reads found (route via backendConfig):"; echo "$hits" | sed 's/^/        /'
else pass "none (platform vars exempt)"; fi

# ── Check 3 · kb/ only imports from the portable surface + host seams ──────
# Allowed: ./ (within kb/), ../lib/ (host helpers), ../_generated/ (Convex
# codegen), and ../config / ../env (the host config seam — the target keeps
# config.ts + env.ts at the convex/ root, same as this repo). Anything else
# escapes the portable surface.
echo
echo "[3] kb/ relative imports limited to ./, ../lib/, ../_generated/, ../config, ../env"
hits=$(grep -rEn 'from "\.\.?/' "$KB" 2>/dev/null \
  | grep -vE 'from "\./' \
  | grep -vE 'from "\.\./lib/' \
  | grep -vE 'from "\.\./_generated/' \
  | grep -vE 'from "\.\./(config|env)"' || true)
if [ -n "$hits" ]; then bad "out-of-module relative imports:"; echo "$hits" | sed 's/^/        /'
else pass "only ./, ../lib/, ../_generated/, ../config, ../env"; fi

# ── Check 4 · No cross-domain internal.*/api.* references in kb/ ───────────
# The §4 import grep misses Convex function references. kb/ may only reference
# internal.kb.* / api.kb.* — anything else (crud, experiments, experimentRuns,
# scraping, …) is a non-portable coupling.
echo
echo "[4] kb/ references only internal.kb.* / api.kb.* (no cross-domain)"
# Lookbehind excludes URLs (e.g. https://api.cohere.com — "api" preceded by "/").
hits=$(grep -rnoP '(?<![\w/."])(internal|api)\.[a-zA-Z_]+' "$KB" 2>/dev/null \
  | grep -vE ":(internal|api)\.kb$" || true)
if [ -n "$hits" ]; then bad "cross-domain function references:"; echo "$hits" | sed 's/^/        /' | sort -u
else pass "none"; fi

# ── Check 5 · eval-lib has no Convex references ────────────────────────────
echo
echo "[5] eval-lib is Convex-free (no convex/values, _generated, convex/ refs)"
if [ ! -d "$EVAL" ]; then skip "eval-lib src not found at $EVAL"
else
  hits=$(grep -rEn 'from "convex|_generated|convex/' "$EVAL" 2>/dev/null || true)
  if [ -n "$hits" ]; then bad "Convex references in eval-lib:"; echo "$hits" | sed 's/^/        /'
  else pass "none"; fi
fi

# ── Check 6 · KB schema closure (needs the schema split) ──────────────────
# Every table kb.schema.ts / shared.schema.ts references via v.id("X") must be
# defined in kb.schema.ts or shared.schema.ts — not agent.schema.ts. Otherwise
# deleting agent.schema.ts (§4.1) breaks the KB module.
echo
echo "[6] KB schema closure — no v.id() into agent.schema.ts"
if [ ! -d "$SCHEMAS" ]; then
  skip "convex/schemas/ absent — needs the schema split integrated"
else
  targets=$(sed 's@//.*@@' "$SCHEMAS/kb.schema.ts" "$SCHEMAS/shared.schema.ts" 2>/dev/null \
    | grep -oE 'v\.id\("[a-zA-Z]+"\)' | grep -oE '"[a-zA-Z]+"' | tr -d '"' | sort -u)
  dangling=""
  for t in $targets; do
    echo "$kb_self" | grep -qx "$t" || dangling="$dangling $t"
  done
  if [ -n "$dangling" ]; then bad "KB schema references tables outside kb/shared:$dangling"
  else pass "all v.id() targets defined in kb.schema.ts / shared.schema.ts"; fi
fi

# ── Check 7 · KB code-to-table closure ────────────────────────────────────
# Every table kb/ touches through ctx.db.insert("X") / ctx.db.query("X") must be
# defined in kb.schema.ts / shared.schema.ts. Check 6 closes the *schema* graph;
# this closes the *code* graph (a kb/ insert into a table that lives in
# agent.schema.ts would sail past check 6, as the stranded crawl tables once did).
echo
echo "[7] KB code closure — kb/ ctx.db only touches kb/shared tables"
if [ ! -d "$SCHEMAS" ]; then
  skip "convex/schemas/ absent — needs the schema split integrated"
else
  touched=$(grep -rhoE 'ctx\.db\.(insert|query)\("[a-zA-Z]+"' "$KB" 2>/dev/null \
    | grep -oE '"[a-zA-Z]+"' | tr -d '"' | sort -u)
  outside=""
  for t in $touched; do
    echo "$kb_self" | grep -qx "$t" || outside="$outside $t"
  done
  if [ -n "$outside" ]; then bad "kb/ ctx.db touches tables outside kb/shared:$outside"
  else pass "all ctx.db tables defined in kb.schema.ts / shared.schema.ts"; fi
fi

echo
echo "==========================================="
if [ "$fail" -eq 0 ]; then
  echo "kb-port-check: PASS — KB module surface is portable."
  exit 0
else
  echo "kb-port-check: FAIL — see ❌ items above."
  exit 1
fi
