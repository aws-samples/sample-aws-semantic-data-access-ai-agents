// Configuration for ACME Corp AgentCore Chat Application
// Values are loaded from environment variables (set via .env file)
// Run ./scripts/generate-env.sh to generate .env from CloudFormation outputs

// Helper to get required env var with validation
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error('Run ./scripts/generate-env.sh to generate .env from CloudFormation outputs');
  }
  return value || '';
}

// Get region with default
const region = process.env.REACT_APP_AWS_REGION || 'us-west-2';

export const config = {
  // AWS Cognito Configuration
  cognito: {
    userPoolId: getRequiredEnv('REACT_APP_COGNITO_USER_POOL_ID'),
    appClientId: getRequiredEnv('REACT_APP_COGNITO_APP_CLIENT_ID'),
    domain: process.env.REACT_APP_COGNITO_DOMAIN || `acme-agentcore.auth.${region}.amazoncognito.com`,
    region: region,
    redirectUri: process.env.REACT_APP_REDIRECT_URI || `${window.location.origin}/callback`,
    logoutUri: process.env.REACT_APP_LOGOUT_URI || window.location.origin,
  },

  // AgentCore Configuration
  agentcore: {
    agentArn: getRequiredEnv('REACT_APP_AGENTCORE_ARN'),
    region: region,
    endpoint: `https://bedrock-agentcore.${region}.amazonaws.com`
  }
};
