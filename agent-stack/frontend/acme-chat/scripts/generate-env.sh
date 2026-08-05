#!/bin/bash
# Generate .env file from CloudFormation stack outputs
# Usage: ./scripts/generate-env.sh [stack-name] [region]

STACK_NAME=${1:-AcmeAgentCoreStack}
REGION=${2:-us-west-2}

echo "Fetching configuration from CloudFormation stack: $STACK_NAME"

# Get outputs from CloudFormation
OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs' \
  --output json 2>/dev/null)

if [ $? -ne 0 ] || [ "$OUTPUTS" == "null" ]; then
  echo "Error: Could not fetch stack outputs. Make sure the stack is deployed."
  exit 1
fi

# Extract values
USER_POOL_ID=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="AuthUserPoolIdC0605E59" or .OutputKey=="CognitoUserPoolId") | .OutputValue' | head -1)
CLIENT_ID=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="AuthFrontendClientId0AADEF2F" or .OutputKey=="CognitoAppClientId") | .OutputValue' | head -1)
AGENT_ARN=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="AgentAgentRuntimeArn5C979E42" or .OutputKey=="AgentArn") | .OutputValue' | head -1)

if [ -z "$USER_POOL_ID" ] || [ -z "$CLIENT_ID" ] || [ -z "$AGENT_ARN" ]; then
  echo "Error: Could not extract required values from stack outputs"
  echo "USER_POOL_ID: $USER_POOL_ID"
  echo "CLIENT_ID: $CLIENT_ID"
  echo "AGENT_ARN: $AGENT_ARN"
  exit 1
fi

# Generate .env file
cat > .env << ENVFILE
# Auto-generated from CloudFormation stack: $STACK_NAME
# Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
REACT_APP_COGNITO_USER_POOL_ID=$USER_POOL_ID
REACT_APP_COGNITO_APP_CLIENT_ID=$CLIENT_ID
REACT_APP_AWS_REGION=$REGION
REACT_APP_AGENTCORE_ARN=$AGENT_ARN
ENVFILE

echo "Generated .env file:"
cat .env
