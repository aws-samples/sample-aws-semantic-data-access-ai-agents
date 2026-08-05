/**
 * Configuration constants for ACME AgentCore Stack
 */

export const Config = {
  // AWS Configuration
  aws: {
    region: 'us-west-2',
    platform: 'linux/arm64',
  },

  // Project naming
  naming: {
    projectPrefix: 'acme',
    stackName: 'AcmeAgentCoreStack',
  },

  // Cognito Configuration
  cognito: {
    userPoolName: 'acme-corp-agentcore-users',
    frontendClientName: 'acme-frontend-client',
    mcpClientName: 'acme-mcp-client',
    passwordPolicy: {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireDigits: true,
      requireSymbols: true,
      tempPasswordValidityDays: 7,
    },
    tokenValidity: {
      idToken: 24, // hours
      accessToken: 24, // hours
      refreshToken: 30, // days
    },
  },

  // Agent Configuration
  agent: {
    runtimeName: 'acme_chatbot',
    model: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    memory: {
      name: 'acme_chat_memory',
      expirationDays: 90,
    },
  },

  // MCP Servers Configuration
  // Docker paths are relative to the cdk/lib directory
  mcpServers: {
    awsDocs: {
      name: 'aws_docs_mcp',
      dockerPath: '../aws-mcp-server-agentcore/aws-documentation-mcp-server',
    },
    dataProcessing: {
      name: 'dataproc_mcp',
      dockerPath: '../aws-mcp-server-agentcore/aws-dataprocessing-mcp-server',
    },
    mysql: {
      name: 'mysql_mcp',
      dockerPath: '../aws-mcp-server-agentcore/aws-mysql-mcp-server',
    },
  },

  // Gateway Configuration
  gateway: {
    name: 'acme-mcp-gateway',
    description: 'ACME Corp MCP Gateway for unified tool access',
    instructions: 'Use this gateway to access AWS documentation search and ACME telemetry data processing tools. Route all tool calls through this gateway.',
  },

  // Visualization bucket for code interpreter charts
  visualization: {
    bucketPrefix: 'acme-visualizations',
    expirationDays: 1,
  },

  // Frontend Configuration
  frontend: {
    bucketNamePrefix: 'acme-chat-frontend',
    buildPath: '../frontend/acme-chat/build',
    cachePolicy: {
      staticAssetsTtlDays: 30,
      staticAssetsMaxTtlDays: 365,
    },
  },

  // Secrets Manager Configuration
  secrets: {
    mcpCredentialsName: 'acme-chatbot/mcp-credentials',
  },

  // Tags
  tags: {
    Project: 'ACME-Corp-AgentCore',
    Environment: 'Production',
    ManagedBy: 'CDK',
  },
} as const;

export type ConfigType = typeof Config;
