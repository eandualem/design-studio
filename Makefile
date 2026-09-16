# Design Studio: one Next.js app (7130) and one assistant-runtime (7100).
SHELL := /bin/bash
.PHONY: help install dev runtime test typecheck lint build check

help: ## List targets
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

install: ## Install app dependencies
	bun install

dev: ## Run the studio on http://localhost:7130
	bun run dev

runtime: ## Start assistant-runtime on 7100 from runtime/design-runtime.env (RUNTIME_DIR=../assistant-runtime)
	scripts/runtime-up.sh $(ARGS)

test: ## Unit tests: machines and lib
	bun run test

typecheck: ## TypeScript
	bun run typecheck

lint: ## ESLint
	bun run lint

build: ## Production build
	bun run build

check: test typecheck lint build ## Everything CI would run
