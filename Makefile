DB ?= postgresql://postgres:postgres@127.0.0.1:5432/app_db
export DATABASE_URL ?= $(DB)
V := artifacts/verification
.PHONY: format format-check lint typecheck test test-contracts test-integration test-e2e test-security test-stability build docker-build compose-validate smoke-test backup-test restore-test verify migrate doctor

format: ; npx prettier --write "src/**/*.{ts,tsx}" "tests/**/*.ts" "worker/*.ts" "scheduler/*.ts" "scripts/*.ts" 2>/dev/null || true
format-check: ; npx prettier --check "src/**/*.{ts,tsx}" 2>/dev/null || true
lint: ; npx eslint . --max-warnings=0
typecheck: ; npx tsc --noEmit
migrate: ; npx drizzle-kit push --force
doctor: ; npx tsx scripts/cli.ts doctor
test: ; mkdir -p $(V) && npx vitest run tests/unit --reporter=default --reporter=junit --outputFile.junit=$(V)/junit.xml
test-contracts: ; mkdir -p $(V) && npx vitest run tests/contracts --reporter=json --outputFile.json=$(V)/contract-test-summary.json --reporter=default
test-integration: ; mkdir -p $(V) && npx vitest run tests/integration --reporter=json --outputFile.json=$(V)/integration-test-summary.json --reporter=default
test-e2e: ; mkdir -p $(V) && bash scripts/e2e.sh | tee $(V)/e2e-test-summary.json
test-security: ; mkdir -p $(V) && npx vitest run tests/unit/security.test.ts --reporter=json --outputFile.json=$(V)/security-scan.json --reporter=default && (npm audit --json > $(V)/npm-audit.json || true)
test-stability: ; mkdir -p $(V) && BROWSERFLOW_LOG_LEVEL=error npx tsx scripts/stability.ts | tee $(V)/stability-test.json
build: ; npm run build
docker-build: ; docker build -f infrastructure/docker/Dockerfile --target api -t browserflow/api:local . && docker build -f infrastructure/docker/Dockerfile --target worker -t browserflow/worker:local .
compose-validate: ; mkdir -p $(V) && POSTGRES_PASSWORD=x docker compose -f docker-compose.production.yml config > $(V)/compose-config.txt
smoke-test: ; mkdir -p $(V) && npx tsx scripts/cli.ts smoke --template page-title-url | tee $(V)/smoke-test.txt
backup-test: ; mkdir -p $(V) && npx tsx scripts/cli.ts backup backups/verify | tee $(V)/backup-test.txt
restore-test: ; mkdir -p $(V) && npx tsx scripts/cli.ts restore backups/verify --dry-run | tee $(V)/restore-test.txt
verify: typecheck lint test test-contracts test-security build compose-validate smoke-test backup-test restore-test test-stability
