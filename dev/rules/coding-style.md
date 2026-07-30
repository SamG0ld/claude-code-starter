---
description: Code style conventions (immutability, file organization, error handling, input validation)
paths:
  - "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,rb,java,php,cs,swift,kt,sql,sh,ps1}"
---

# Coding Style

## Immutability
Create new objects rather than mutating existing ones. Spread or copy and return a new value instead of assigning to a field in place.

## File organization
Prefer many small files over few large ones:
- High cohesion, low coupling
- 200-400 lines typical, 800 max
- Extract utilities out of large components
- Organize by feature/domain, not by type

## Error handling
Handle errors at the boundary: catch, log with context, and surface a clear, user-meaningful message rather than a raw stack trace.

## Input validation
Validate external input at the boundary (e.g. a zod schema) before trusting it.

## Quality checklist
Before marking work complete: readable and well-named, small functions, focused files (under 800 lines), no deep nesting, proper error handling, no leftover console.log, no hardcoded values, immutable patterns used.
