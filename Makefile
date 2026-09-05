.PHONY: help venv install install-dev format format-check lint typecheck \
	test test-unit test-contracts test-integration test-e2e test-security \
	test-stability build docker-build compose-validate smoke-test \
	backup-test restore-test verify migrate secrets web-install web-build \
	web-test web-typecheck web-lint pre-commit doctor cleanup

PYTHON ?= .venv/bin/python
PIP ?= .venv/bin/pip
PYTEST ?= .venv/bin/pytest
RUFF ?= .venv/bin/ruff
MYPY ?= .venv/bin/mypy
PNPM ?= pnpm
COMPOSE ?= docker compose
export PYTHONPATH := packages/domain:packages/application:packages/infrastructure:packages/flow_schema:packages/flow_compiler:packages/execution_contracts:packages/node_sdk:packages/node_pack_browser:packages/node_pack_control:packages/node_pack_data:packages/node_pack_integration:packages/cli:apps/api:apps/scheduler:apps/browser_worker:$(PYTHONPATH)

help:
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-22s %s\n", $$1, $$2}'

venv: ## Create the Python virtualenv
	python3 -m venv .venv
	$(PIP) install -U pip wheel setuptools

install: ## Install production Python package
	$(PIP) install -e .

install-dev: ## Install Python package with development extras
	$(PIP) install -e ".[dev]"
	$(PNPM) install

secrets: ## Generate local master and session key files
	mkdir -p secrets
	test -f secrets/master.key || $(PYTHON) -c "import os,pathlib; pathlib.Path('secrets/master.key').write_bytes(os.urandom(32))"
	test -f secrets/session.secret || $(PYTHON) -c "import os,pathlib; pathlib.Path('secrets/session.secret').write_bytes(os.urandom(48))"
	chmod 600 secrets/master.key secrets/session.secret

format: ## Auto-format Python and frontend
	$(RUFF) format apps packages tests scripts
	$(RUFF) check --fix apps packages tests scripts
	$(PNPM) --filter @browserflow/web exec -- prettier --write "src/**/*.{ts,tsx,css}" || true

format-check: ## Check formatting without writing
	$(RUFF) format --check apps packages tests scripts
	$(RUFF) check apps packages tests scripts

lint: ## Lint Python and frontend
	$(RUFF) check apps packages tests scripts
	$(PNPM) --filter @browserflow/web lint

typecheck: ## Type-check Python and frontend
	$(MYPY) packages apps/api apps/scheduler apps/browser_worker
	$(PNPM) --filter @browserflow/web typecheck

test: ## Run unit tests with coverage
	$(PYTEST) tests/unit -m "unit or not integration and not e2e and not stability" \
		--cov --cov-report=xml:artifacts/verification/coverage.xml \
		--cov-report=term-missing \
		--junitxml=artifacts/verification/junit.xml

test-unit: ## Unit tests only
	$(PYTEST) tests/unit -m unit --junitxml=artifacts/verification/junit.xml

test-contracts: ## Node and API contract tests
	$(PYTEST) tests/contracts -m contract --junitxml=artifacts/verification/contract-junit.xml
	$(PYTHON) scripts/write_test_summary.py --suite contracts --out artifacts/verification/contract-test-summary.json

test-integration: ## PostgreSQL integration tests
	$(PYTEST) tests/integration -m integration --junitxml=artifacts/verification/integration-junit.xml
	$(PYTHON) scripts/write_test_summary.py --suite integration --out artifacts/verification/integration-test-summary.json

test-e2e: ## Chromium end-to-end tests
	$(PYTEST) tests/e2e -m e2e --junitxml=artifacts/verification/e2e-junit.xml
	$(PNPM) --filter @browserflow/web test:e2e || true
	$(PYTHON) scripts/write_test_summary.py --suite e2e --out artifacts/verification/e2e-test-summary.json

test-security: ## Security policy tests
	$(PYTEST) tests/security -m security --junitxml=artifacts/verification/security-junit.xml

test-stability: ## Reliability and restart tests
	$(PYTEST) tests/stability -m stability --junitxml=artifacts/verification/stability-junit.xml
	$(PYTHON) scripts/write_test_summary.py --suite stability --out artifacts/verification/stability-test.json

web-install:
	$(PNPM) install

web-build:
	$(PNPM) --filter @browserflow/web build

web-test:
	$(PNPM) --filter @browserflow/web test -- --reporter=junit --outputFile=../../artifacts/verification/frontend-junit.xml

web-typecheck:
	$(PNPM) --filter @browserflow/web typecheck

web-lint:
	$(PNPM) --filter @browserflow/web lint

build: ## Build Python wheel and frontend
	$(PYTHON) -m pip wheel -w dist --no-deps .
	$(PNPM) --filter @browserflow/web build

docker-build: ## Build production images
	$(COMPOSE) -f docker-compose.production.yml build

compose-validate: ## Validate compose files
	$(COMPOSE) -f docker-compose.yml config > artifacts/verification/compose-config.txt
	$(COMPOSE) -f docker-compose.production.yml config >> artifacts/verification/compose-config.txt

migrate: ## Run Alembic migrations
	$(PYTHON) -m alembic upgrade head

smoke-test: ## Compose smoke test
	$(PYTHON) scripts/smoke_test.py | tee artifacts/verification/smoke-test.txt

backup-test: ## Backup round-trip test
	$(PYTHON) scripts/backup.py --output /tmp/browserflow-backup-test.tar.gz --yes
	$(PYTHON) scripts/backup.py --verify /tmp/browserflow-backup-test.tar.gz | tee artifacts/verification/backup-test.txt

restore-test: ## Restore test against a disposable database
	$(PYTHON) scripts/restore.py --archive /tmp/browserflow-backup-test.tar.gz --dry-run | tee artifacts/verification/restore-test.txt

doctor: ## Environment diagnostics
	$(PYTHON) scripts/doctor.py

cleanup: ## Retention cleanup (dry-run by default)
	$(PYTHON) scripts/cleanup.py --dry-run

verify: format-check lint typecheck test-unit test-contracts test-integration test-e2e test-security compose-validate ## Full verification gate
	$(PYTHON) scripts/write_test_summary.py --suite all --out artifacts/verification/test-summary.json
	@echo "verify complete"
