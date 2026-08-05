#!/bin/bash
# Pre-deployment preflight checks for ACME AgentCore
# Validates all prerequisites before running cdk deploy
# Usage: ./preflight.sh [--region REGION]

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Defaults
REGION="us-west-2"
CDK_QUALIFIER="hnb659fds"

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --region) REGION="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: ./preflight.sh [--region REGION]"
      echo "  --region   AWS region (default: us-west-2)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_BUILD="$SCRIPT_DIR/agent-stack/frontend/acme-chat/build"

# Counters
PASS=0
FAIL=0
WARN=0
FIXED=0

pass()  { echo -e " ${GREEN}[PASS]${NC}  $1"; ((PASS++)); }
fail()  { echo -e " ${RED}[FAIL]${NC}  $1"; ((FAIL++)); }
warn()  { echo -e " ${YELLOW}[WARN]${NC}  $1"; ((WARN++)); }
fixed() { echo -e " ${BLUE}[FIXED]${NC} $1"; ((FIXED++)); }

# ── Header (account filled in after credential check) ──
ACCOUNT=""

print_header() {
  echo ""
  echo "=========================================="
  echo "  ACME Deployment Preflight Checks"
  echo "  Region: $REGION  |  Account: ${ACCOUNT:-unknown}"
  echo "=========================================="
  echo ""
}

# ── 1. AWS CLI ──
check_aws_cli() {
  if ! command -v aws &>/dev/null; then
    fail "AWS CLI not installed"
    return 1
  fi
  local ver
  ver=$(aws --version 2>&1 | awk '{print $1}' | cut -d/ -f2)
  pass "AWS CLI v${ver}"
}

# ── 2. AWS Credentials ──
check_aws_credentials() {
  local identity
  if ! identity=$(aws sts get-caller-identity --region "$REGION" --output json 2>&1); then
    fail "AWS credentials invalid or expired"
    return 1
  fi
  ACCOUNT=$(echo "$identity" | grep -o '"Account": *"[^"]*"' | cut -d'"' -f4)
  local arn
  arn=$(echo "$identity" | grep -o '"Arn": *"[^"]*"' | cut -d'"' -f4)
  pass "AWS credentials valid (${arn})"
}

# ── 3. Docker ──
check_docker() {
  if ! command -v docker &>/dev/null; then
    fail "Docker not installed"
    return 1
  fi
  if ! docker info &>/dev/null; then
    fail "Docker daemon is not running"
    return 1
  fi
  pass "Docker daemon running"
}

# ── 4. Node.js >= 18 ──
check_node() {
  if ! command -v node &>/dev/null; then
    fail "Node.js not installed"
    return 1
  fi
  local ver
  ver=$(node --version | sed 's/^v//')
  local major
  major=$(echo "$ver" | cut -d. -f1)
  if [[ "$major" -lt 18 ]]; then
    fail "Node.js v${ver} (>= 18 required)"
    return 1
  fi
  pass "Node.js v${ver} (>= 18 required)"
}

# ── 5. npm ──
check_npm() {
  if ! command -v npm &>/dev/null; then
    fail "npm not installed"
    return 1
  fi
  local ver
  ver=$(npm --version)
  pass "npm v${ver}"
}

# ── 6. CDK CLI ──
check_cdk() {
  if ! command -v cdk &>/dev/null; then
    fail "CDK CLI not installed (npm install -g aws-cdk)"
    return 1
  fi
  local ver
  ver=$(cdk --version 2>&1 | awk '{print $1}')
  pass "CDK CLI v${ver}"
}

# ── 7. CDK Bootstrap stack ──
check_cdk_bootstrap() {
  local stack_name="CDKToolkit"
  local status
  if ! status=$(aws cloudformation describe-stacks --stack-name "$stack_name" \
      --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>&1); then
    fail "CDK bootstrap stack not found — run: cdk bootstrap aws://${ACCOUNT}/${REGION}"
    return 1
  fi
  if [[ "$status" != *"COMPLETE"* ]]; then
    fail "CDK bootstrap stack in bad state: ${status}"
    return 1
  fi
  # Get bootstrap version
  local version
  version=$(aws cloudformation describe-stacks --stack-name "$stack_name" \
    --region "$REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`BootstrapVersion`].OutputValue' \
    --output text 2>/dev/null || echo "unknown")
  pass "CDK bootstrap stack (version ${version})"
}

# ── 8. CDK ECR repo ──
check_cdk_ecr() {
  local repo_name="cdk-${CDK_QUALIFIER}-container-assets-${ACCOUNT}-${REGION}"
  if aws ecr describe-repositories --repository-names "$repo_name" \
      --region "$REGION" &>/dev/null; then
    pass "CDK ECR repo exists (${repo_name})"
    return
  fi
  # Auto-fix: create it
  if aws ecr create-repository --repository-name "$repo_name" \
      --region "$REGION" &>/dev/null; then
    fixed "CDK ECR repo created: ${repo_name}"
  else
    fail "CDK ECR repo missing and could not create: ${repo_name}"
  fi
}

# ── 9. Frontend build ──
check_frontend_build() {
  if [[ -d "$FRONTEND_BUILD" ]]; then
    pass "Frontend build directory exists"
  else
    warn "Frontend not built — run: cd agent-stack/frontend/acme-chat && npm run build"
  fi
}

# ── 10. jq ──
check_jq() {
  if ! command -v jq &>/dev/null; then
    warn "jq not installed (optional, used by deploy-frontend.sh)"
    return
  fi
  local ver
  ver=$(jq --version 2>&1 | sed 's/^jq-//')
  pass "jq v${ver}"
}

# ── Run all checks ──
# Silently resolve account for header
if command -v aws &>/dev/null; then
  identity=$(aws sts get-caller-identity --region "$REGION" --output json 2>/dev/null || true)
  if [[ -n "$identity" ]]; then
    ACCOUNT=$(echo "$identity" | grep -o '"Account": *"[^"]*"' | cut -d'"' -f4)
  fi
fi

print_header

check_aws_cli || true
check_aws_credentials || true

# Short-circuit if no valid credentials (remaining checks need them)
if [[ -z "$ACCOUNT" ]]; then
  echo ""
  echo -e "${RED}Cannot continue without valid AWS credentials.${NC}"
  exit 1
fi

check_docker || true
check_node || true
check_npm || true
check_cdk || true
check_cdk_bootstrap || true
check_cdk_ecr || true
check_frontend_build
check_jq

# ── Summary ──
TOTAL=$((PASS + FAIL + WARN + FIXED))
echo ""
echo "=========================================="
PARTS=()
[[ $PASS  -gt 0 ]] && PARTS+=("${PASS} passed")
[[ $FIXED -gt 0 ]] && PARTS+=("${FIXED} fixed")
[[ $WARN  -gt 0 ]] && PARTS+=("${WARN} warning(s)")
[[ $FAIL  -gt 0 ]] && PARTS+=("${FAIL} failed")
SUMMARY=$(printf '%s, ' "${PARTS[@]}" | sed 's/, $//')
echo "  Result: ${SUMMARY}"

if [[ $FAIL -gt 0 ]]; then
  echo -e "  ${RED}Fix the above errors before deploying.${NC}"
  echo "=========================================="
  exit 1
else
  echo -e "  ${GREEN}Ready to deploy!${NC}"
  echo "=========================================="
  exit 0
fi
