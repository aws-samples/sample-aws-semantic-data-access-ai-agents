#!/bin/bash
# Deploy frontend to S3 and invalidate CloudFront cache
# This script regenerates .env from CloudFormation, rebuilds, and deploys
# Usage: ./scripts/deploy-frontend.sh [stack-name] [region]

set -e

STACK_NAME=${1:-AcmeAgentCoreStack}
REGION=${2:-us-west-2}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$FRONTEND_DIR"

echo "=========================================="
echo "Frontend Deployment"
echo "Stack: $STACK_NAME"
echo "Region: $REGION"
echo "=========================================="

# Step 1: Fetch CloudFormation outputs
echo ""
echo "Step 1: Fetching CloudFormation outputs..."

OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs' \
  --output json 2>/dev/null)

if [ $? -ne 0 ] || [ "$OUTPUTS" == "null" ]; then
  echo "Error: Could not fetch stack outputs. Make sure the stack is deployed."
  exit 1
fi

# Get S3 bucket name
BUCKET=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="FrontendS3BucketNameC6E6DF48") | .OutputValue')

# Get CloudFront distribution ID
DIST_ID=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="FrontendDistributionId6CBC2EDF") | .OutputValue')

if [ -z "$BUCKET" ] || [ "$BUCKET" == "null" ]; then
  echo "Error: Could not find S3 bucket. Make sure the stack is deployed."
  exit 1
fi

if [ -z "$DIST_ID" ] || [ "$DIST_ID" == "null" ]; then
  echo "Error: Could not find CloudFront distribution ID. Make sure the stack is deployed."
  exit 1
fi

echo "  S3 Bucket: $BUCKET"
echo "  CloudFront Distribution: $DIST_ID"

# Step 2: Generate .env from CloudFormation outputs
echo ""
echo "Step 2: Generating .env from CloudFormation outputs..."

USER_POOL_ID=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="AuthUserPoolIdC0605E59" or .OutputKey=="CognitoUserPoolId") | .OutputValue' | head -1)
CLIENT_ID=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="AuthFrontendClientId0AADEF2F" or .OutputKey=="CognitoAppClientId") | .OutputValue' | head -1)
AGENT_ARN=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="AgentAgentRuntimeArn5C979E42" or .OutputKey=="AgentArn") | .OutputValue' | head -1)

if [ -z "$USER_POOL_ID" ] || [ -z "$CLIENT_ID" ] || [ -z "$AGENT_ARN" ]; then
  echo "Error: Could not extract required Cognito/Agent values from stack outputs"
  echo "  USER_POOL_ID: $USER_POOL_ID"
  echo "  CLIENT_ID: $CLIENT_ID"
  echo "  AGENT_ARN: $AGENT_ARN"
  exit 1
fi

cat > .env << ENVFILE
# Auto-generated from CloudFormation stack: $STACK_NAME
# Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
REACT_APP_COGNITO_USER_POOL_ID=$USER_POOL_ID
REACT_APP_COGNITO_APP_CLIENT_ID=$CLIENT_ID
REACT_APP_AWS_REGION=$REGION
REACT_APP_AGENTCORE_ARN=$AGENT_ARN
ENVFILE

echo "  Generated .env with:"
echo "    REACT_APP_COGNITO_USER_POOL_ID=$USER_POOL_ID"
echo "    REACT_APP_COGNITO_APP_CLIENT_ID=$CLIENT_ID"
echo "    REACT_APP_AGENTCORE_ARN=$AGENT_ARN"

# Step 3: Build the frontend
echo ""
echo "Step 3: Building frontend..."
npm run build

if [ ! -d "build" ]; then
  echo "Error: build/ directory not found after build."
  exit 1
fi

# Step 4: Sync to S3
echo ""
echo "Step 4: Syncing build/ to S3..."
aws s3 sync build "s3://$BUCKET" --delete --region "$REGION"

# Step 5: Invalidate CloudFront cache
echo ""
echo "Step 5: Invalidating CloudFront cache..."
INVALIDATION=$(aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*" \
  --region "$REGION" \
  --query 'Invalidation.[Id,Status]' \
  --output text)

echo "  Invalidation: $INVALIDATION"

# Get frontend URL
FRONTEND_URL=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="FrontendUrl") | .OutputValue')

echo ""
echo "=========================================="
echo "✅ Frontend deployed successfully!"
echo "=========================================="
echo ""
echo "URL: $FRONTEND_URL"
echo ""
echo "Configuration deployed:"
echo "  - Cognito User Pool: $USER_POOL_ID"
echo "  - Cognito Client ID: $CLIENT_ID"
echo "  - Agent ARN: $AGENT_ARN"
echo ""
echo "Note: CloudFront invalidation may take 1-2 minutes to complete."
