# Design Studio: one Next.js app (7130) talking to an assistant-runtime you
# start yourself (7100 by default; NEXT_PUBLIC_RUNTIME_URL to point elsewhere).
# Nothing here starts, replaces or stops the runtime.
SHELL := /bin/bash
.PHONY: help install preflight dev test typecheck lint build check

help: ## List targets
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

install: ## Install app dependencies
	bun install

preflight: ## Check the runtime is reachable and healthy; exits nonzero with what to do
	bun scripts/preflight.mjs

dev: preflight ## Run the studio on http://localhost:7130 (runtime must already be up)
	bun run dev

test: ## Unit tests: machines and lib
	bun run test

typecheck: ## TypeScript
	bun run typecheck

lint: ## ESLint
	bun run lint

build: ## Production build
	bun run build

check: test typecheck lint build ## Everything CI would run
