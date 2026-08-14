# Claude Agent Control Plane Alpha Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver a fail-closed, programmable Claude Agent SDK control-plane slice that runs one writer, deterministic Foundation gates, one fresh read-only reviewer, and PROOF without changing `main` or enabling external-model EXECUTE.

**Architecture:** Foundation 0.1.4 remains the quality authority. A new native-ESM control-plane layer dynamically loads the pinned Claude Agent SDK only for live execution, while unit and integration tests inject a fake `query()` implementation. The runner derives all permissions from the validated TaskEnvelope, records lifecycle events in the existing chained ledger, obtains fresh Git evidence, seals an EvidenceBundle, and lets existing PROOF return `PASS` or `BLOCKED`.

**Tech Stack:** Node.js 20+, native ESM, Git, ForgeAI Foundation 0.1.4, Claude Agent SDK package `@anthropic-ai/claude-agent-sdk` pinned to `0.3.232` for the live adapter.

## Global Constraints

- Claude Code/Opus remains the orchestrator; Superpowers remains the methodology.
- Foundation 0.1.4 contracts, policy, gates, evidence, ledger, Git verification, and PROOF remain authoritative.
- One writer owns one coherent change; nested agents and the SDK `Agent` tool are forbidden.
- The reviewer is a separate top-level SDK query with a fresh session and read-only tools.
- MCP tools and network tools are denied in this alpha EXECUTE path.
- The SDK is optional at package-install time; live execution fails closed when the exact supported SDK is unavailable.
- No runtime or development dependency is added to the Foundation root package.
- No change is made to `main`, PR #6 readiness, or the pending independent-review/live-smoke gates.
- OpenHands and MCP→LiteLLM EXECUTE remain outside this plan.

---

## File Structure

- Create `src/control-plane/constants.mjs`: alpha schema versions, SDK identity, tool profiles, and hard limits.
- Create `src/control-plane/contracts.mjs`: strict validation and normalization of the control-plane run policy and structured writer/reviewer results.
- Create `src/control-plane/sdk-adapter.mjs`: exact SDK discovery, query-option construction, async message collection, budget/turn enforcement, and structured-output validation.
- Create `src/control-plane/prompts.mjs`: deterministic writer and reviewer prompts that treat repository content as data and bind outputs to task/commit identities.
- Create `src/control-plane/runner.mjs`: writer → Git/gates → reviewer → evidence → PROOF orchestration with ledger persistence.
- Create `bin/forgeai-control-plane.mjs`: `doctor` and `run` CLI commands.
- Create `config/control-plane-policy.json`: pinned SDK and conservative default budgets.
- Create `schemas/control-plane-policy-v0.2.0-alpha.1.schema.json`: machine-readable policy contract.
- Create `schemas/writer-result-v0.2.0-alpha.1.schema.json`: structured writer result contract.
- Create `schemas/reviewer-result-v0.2.0-alpha.1.schema.json`: structured reviewer result contract.
- Create `tests/control-plane-contracts.test.mjs`: contract and schema alignment tests.
- Create `tests/control-plane-sdk-adapter.test.mjs`: SDK option and terminal-result tests.
- Create `tests/control-plane-runner.test.mjs`: end-to-end fake-SDK tests against real temporary Git repositories.
- Create `tests/control-plane-cli.test.mjs`: fail-closed SDK doctor and CLI argument tests.
- Modify `package.json`: expose the control-plane binary and script without adding dependencies.
- Modify `README.md`, `CHANGELOG.md`, `SBOM.spdx.json`, and `docs/OPERATIONS_RUNBOOK.md`: document alpha scope, install precondition, and verified behavior.
- Regenerate `SOURCE_MANIFEST.json` after all source changes.

### Task 1: Control-Plane Contracts and Structured Output Schemas

**Files:**
- Create: `src/control-plane/constants.mjs`
- Create: `src/control-plane/contracts.mjs`
- Create: `schemas/control-plane-policy-v0.2.0-alpha.1.schema.json`
- Create: `schemas/writer-result-v0.2.0-alpha.1.schema.json`
- Create: `schemas/reviewer-result-v0.2.0-alpha.1.schema.json`
- Create: `tests/control-plane-contracts.test.mjs`

**Interfaces:**
- Consumes: `validateTaskEnvelope()`, `assertOnlyKeys()`, `assertSafeText()`, `isPlainObject()`, and canonical hashing utilities.
- Produces: `validateControlPlanePolicy(policy)`, `normalizeControlPlanePolicy(policy)`, `validateWriterResult(result, task)`, `validateReviewerResult(result, task, finalCommit)`, `WRITER_OUTPUT_SCHEMA`, and `REVIEWER_OUTPUT_SCHEMA`.

- [x] **Step 1: Write failing contract tests**

Test exact schema versions, unexpected-key rejection, bounded turns and budgets, total-budget consistency, exact SDK package/version, writer acceptance-ID coverage, SHA validation, reviewer commit binding, bounded findings, and PASS/BLOCKED verdict consistency.

- [x] **Step 2: Run the focused tests and confirm failure**

Run: `node --test --test-concurrency=1 tests/control-plane-contracts.test.mjs`

Expected: FAIL because the control-plane modules do not exist.

- [x] **Step 3: Implement constants, JSON schemas, and runtime validators**

Use strict allowlists and finite numeric bounds. Reject any result that omits an acceptance criterion, invents an acceptance ID, reports an invalid commit, exceeds limits, or declares `PASS` while carrying an open high/critical finding.

- [x] **Step 4: Prove contract behavior and schema alignment**

Run: `node --test --test-concurrency=1 tests/control-plane-contracts.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit the contract slice**

```bash
git add src/control-plane/constants.mjs src/control-plane/contracts.mjs schemas/control-plane-policy-v0.2.0-alpha.1.schema.json schemas/writer-result-v0.2.0-alpha.1.schema.json schemas/reviewer-result-v0.2.0-alpha.1.schema.json tests/control-plane-contracts.test.mjs
git commit -m "feat: add control-plane alpha contracts"
```

### Task 2: Claude Agent SDK Adapter

**Files:**
- Create: `src/control-plane/sdk-adapter.mjs`
- Create: `tests/control-plane-sdk-adapter.test.mjs`

**Interfaces:**
- Consumes: validated policy, validated TaskEnvelope, structured-output schemas, Foundation `checkToolUse()`, and ledger append callbacks.
- Produces: `loadClaudeAgentSdk()`, `buildWriterOptions()`, `buildReviewerOptions()`, and `invokeStructuredAgent()`.

- [x] **Step 1: Write failing adapter tests**

Cover writer/reviewer `tools` and `allowedTools` profiles, fail-closed sandbox options, MCP disabled, `permissionMode: "dontAsk"`, `settingSources: []`, `maxTurns`, `maxBudgetUsd`, absolute TaskEnvelope deadline, `AbortController`, structured output, allowlisted environment, Foundation `canUseTool` decisions, missing SDK, hung or invalid iterator, missing terminal result, SDK error subtype, malformed structured output, repeated terminal results, budget overflow, turn overflow, and session-ID absence.

- [x] **Step 2: Run focused tests and confirm failure**

Run: `node --test --test-concurrency=1 tests/control-plane-sdk-adapter.test.mjs`

Expected: FAIL because the adapter does not exist.

- [x] **Step 3: Implement the lazy exact-version SDK loader**

Resolve `@anthropic-ai/claude-agent-sdk` only when live execution starts. Locate its package metadata, require version `0.3.232`, and require an exported `query` function. Return a clear fail-closed error for missing or mismatched installations.

- [x] **Step 4: Implement locked-down query options and terminal-result collection**

Writer tools: `Read`, `Glob`, `Grep`, `Edit`, `Write`, `Bash`. Reviewer tools: `Read`, `Glob`, `Grep`. Deny `Agent`, task/team tools, web/network tools, MCP tools, and all write/shell tools for the reviewer. Do not load project settings in this alpha; use Foundation policy through `canUseTool` to avoid recursive completion hooks before PROOF exists.

- [x] **Step 5: Prove adapter behavior**

Run: `node --test --test-concurrency=1 tests/control-plane-sdk-adapter.test.mjs`

Expected: PASS.

- [x] **Step 6: Commit the adapter slice**

```bash
git add src/control-plane/sdk-adapter.mjs tests/control-plane-sdk-adapter.test.mjs
git commit -m "feat: add locked-down Claude SDK adapter"
```

### Task 3: Prompts, Fresh Reviewer Task, and Orchestration Runner

**Files:**
- Create: `src/control-plane/prompts.mjs`
- Create: `src/control-plane/runner.mjs`
- Create: `tests/control-plane-runner.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–2, Foundation ledger, gate runner, Git proof, artifact manifest, EvidenceBundle, and PROOF.
- Produces: `runControlPlane({ task, policy, query, sdkVersion, now })` returning a sealed control-plane result with `PASS` or `BLOCKED`.

- [x] **Step 1: Write failing end-to-end tests with an injected fake SDK**

Use real temporary Git repositories. The fake writer edits and commits a scoped file before returning structured output; the fake reviewer receives a separate read-only invocation. Assert writer-first ordering, deterministic gate execution, fresh session identity, exact tool profiles, ledger events, EvidenceBundle creation, PROOF PASS, and written runtime paths.

- [x] **Step 2: Add fail-closed scenario tests**

Cover gate failure preventing review, writer final-commit mismatch, out-of-scope Git change, writer BLOCKED result, reviewer BLOCKED result, reused writer/reviewer session ID, task expiration during a hung writer, malformed SDK result, missing SDK, and budget overflow. Every scenario must return a structured `BLOCKED` result and must never write a PASS proof.

- [x] **Step 3: Run focused tests and confirm failure**

Run: `node --test --test-concurrency=1 tests/control-plane-runner.test.mjs`

Expected: FAIL because the runner and prompts do not exist.

- [x] **Step 4: Implement deterministic prompts and the sequential runner**

The writer prompt contains the normalized task and requires one coherent committed change, TDD, no delegation, and structured output. The reviewer prompt contains only the normalized task, fresh Git state, gate results, writer claims, and exact commit identity; repository content is explicitly untrusted data. The runner writes protected runtime state, appends ledger events, recomputes Git state, executes required gates, starts a fresh reviewer session, seals evidence, verifies artifacts and ledger, calls PROOF, and writes `latest-proof.json` only from the PROOF result.

- [x] **Step 5: Prove the full alpha lifecycle**

Run: `node --test --test-concurrency=1 tests/control-plane-runner.test.mjs`

Expected: PASS.

- [x] **Step 6: Commit the orchestration slice**

```bash
git add src/control-plane/prompts.mjs src/control-plane/runner.mjs tests/control-plane-runner.test.mjs
git commit -m "feat: orchestrate writer review gates and PROOF"
```

### Task 4: CLI and Operator Policy

**Files:**
- Create: `bin/forgeai-control-plane.mjs`
- Create: `config/control-plane-policy.json`
- Create: `tests/control-plane-cli.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `loadClaudeAgentSdk()` and `runControlPlane()`.
- Produces: `forgeai-control-plane doctor` and `forgeai-control-plane run <task.json> <policy.json> [result.json]`.

- [x] **Step 1: Write failing CLI tests**

Assert bounded argument handling, helpful usage, `doctor` reporting the exact expected SDK and failing closed when absent, and `run` refusing invalid task/policy input before SDK invocation.

- [x] **Step 2: Run focused tests and confirm failure**

Run: `node --test --test-concurrency=1 tests/control-plane-cli.test.mjs`

Expected: FAIL because the binary does not exist.

- [x] **Step 3: Implement the CLI and conservative default policy**

The default policy pins SDK `0.3.232`, writer/reviewer turn limits, per-role budgets, total budget, and explicit model fields. CLI output is atomically written under the workspace and never hides a blocked verdict.

- [x] **Step 4: Prove CLI behavior**

Run: `node --test --test-concurrency=1 tests/control-plane-cli.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit the CLI slice**

```bash
git add bin/forgeai-control-plane.mjs config/control-plane-policy.json tests/control-plane-cli.test.mjs package.json
git commit -m "feat: expose control-plane alpha CLI"
```

### Task 5: Documentation, Manifest, and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `SBOM.spdx.json`
- Modify: `docs/OPERATIONS_RUNBOOK.md`
- Modify: `SOURCE_MANIFEST.json`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: reproducible operator instructions and an exact sealed source inventory.

- [x] **Step 1: Document the verified boundary**

State that the control-plane core and fake-SDK lifecycle are verified, while a live paid SDK call, live Claude Code CLI smoke, independent review, and Foundation merge remain separate gates. Document the exact SDK package/version and install command without claiming it is bundled.

- [x] **Step 2: Regenerate the exact source manifest**

Run: `node scripts/source-manifest.mjs`

Expected: `manifest PASS` with every new source, test, schema, config, and plan included.

- [x] **Step 3: Run narrow and broad verification**

Run in order:

```bash
node --test --test-concurrency=1 tests/control-plane-contracts.test.mjs
node --test --test-concurrency=1 tests/control-plane-sdk-adapter.test.mjs
node --test --test-concurrency=1 tests/control-plane-runner.test.mjs
node --test --test-concurrency=1 tests/control-plane-cli.test.mjs
npm test
npm run lint
npm run verify
```

Expected: all commands PASS and the worktree is clean after committing the manifest and documentation.

- [x] **Step 4: Review the integrated diff**

Check that no external-worker EXECUTE route, no OpenHands dependency, no SDK credential, no model fallback, no project-settings recursion, and no change to existing Foundation PASS semantics entered the branch.

- [x] **Step 5: Commit the release-candidate slice**

```bash
git add README.md CHANGELOG.md SBOM.spdx.json docs/OPERATIONS_RUNBOOK.md docs/superpowers/plans/2026-08-14-claude-agent-control-plane-alpha.md SOURCE_MANIFEST.json
git commit -m "docs: finalize control-plane alpha evidence"
```

### Task 6: Stacked GitHub Delivery

**Files:**
- No additional product files.

**Interfaces:**
- Consumes: the clean verified local branch.
- Produces: a stacked draft PR based on `forgeai/foundation-0.1.4`.

- [ ] **Step 1: Confirm branch authority**

Verify the parent tree remains `925cb1097668874865a68c536c656da3ad504f07` and `main` remains `5f94609e98f4882cc891e3c05b3ab83f16300cc4`.

- [ ] **Step 2: Publish the exact verified tree atomically**

Create Git blobs/tree/commit or an equivalently sealed GitHub Actions transport. Compare the remote tree SHA to the local verified tree before opening a PR.

- [ ] **Step 3: Open a stacked draft PR**

Base: `forgeai/foundation-0.1.4`.

Head: `forgeai/control-plane-0.2.0-alpha.1`.

The PR must state that live Claude Agent SDK execution is pending and must not be merged before Foundation plus its independent review/live-smoke/human gates.

- [ ] **Step 4: Require fresh CI and preserve the merge boundary**

Keep the PR in draft. Do not modify or merge `main`. Record exact HEAD/tree, test counts, CI status, SDK pin, and remaining live gates in the handoff.
