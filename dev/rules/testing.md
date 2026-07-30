---
description: Test coverage targets, TDD workflow, and which agents to use for tests
paths:
  - "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,rb,java,php,cs,swift,kt,sql,sh,ps1}"
---

# Testing Requirements

## Coverage
Target 80% minimum across three test types:
- Unit: individual functions, utilities, components
- Integration: API endpoints, database operations
- E2E: critical user flows (Playwright)

## Test-driven development
Write the test first and watch it fail, write the minimal implementation to make it pass, then refactor. Use the **tdd-guide** agent for new features and bug fixes.

## When tests fail
Check test isolation and mocks first. Fix the implementation, not the test, unless the test itself is wrong.

## Agents
- **tdd-guide**: write-tests-first for new features
- **e2e-runner**: Playwright E2E flows
