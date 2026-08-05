import { Construct } from 'constructs';
import {
  Stack,
  StackProps,
  Tags,
  RemovalPolicy,
  CfnOutput,
} from 'aws-cdk-lib';
import { CognitoConstruct } from './constructs/cognito-construct';
import { SecretsConstruct } from './constructs/secrets-construct';
import { MemoryConstruct } from './constructs/memory-construct';
import { McpServerConstruct } from './constructs/mcp-server-construct';
import { OAuthProviderConstruct } from './constructs/oauth-provider-construct';
import { AgentRuntimeConstruct } from './constructs/agent-runtime-construct';
import { GatewayConstruct } from './constructs/gateway-construct';
import { FrontendConstruct } from './constructs/frontend-construct';
import { AuroraConstruct } from './constructs/aurora-construct';
import { Config } from './config';

export interface AcmeAgentCoreStackProps extends StackProps {
  /**
   * Whether to deploy in development mode (DESTROY removal policy)
   * @default true
   */
  readonly developmentMode?: boolean;
}

/**
 * ACME Corp AgentCore Stack
 *
 * This stack deploys the complete ACME chatbot infrastructure:
 * - Cognito User Pool for authentication
 * - Secrets Manager for MCP credentials
 * - AgentCore Memory for conversation persistence
 * - Aurora MySQL Serverless v2 (CRM data via RDS Data API)
 * - MCP Servers (AWS Docs, DataProcessing, MySQL)
 * - Main Agent Runtime (Strands + Claude Haiku 4.5)
 * - Frontend (React app on S3 + CloudFront)
 */
export class AcmeAgentCoreStack extends Stack {
  public readonly frontendUrl: string;
  public readonly agentArn: string;
  public readonly userPoolId: string;
  public readonly frontendClientId: string;

  constructor(scope: Construct, id: string, props?: AcmeAgentCoreStackProps) {
    super(scope, id, {
      ...props,
      env: props?.env ?? {
        region: Config.aws.region,
      },
    });

    const developmentMode = props?.developmentMode ?? true;
    const removalPolicy = developmentMode ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;

    // Apply tags to all resources
    for (const [key, value] of Object.entries(Config.tags)) {
      Tags.of(this).add(key, value);
    }

    // ========================================
    // 1. Authentication Layer (Cognito)
    // ========================================
    const auth = new CognitoConstruct(this, 'Auth', {
      removalPolicy,
    });

    // ========================================
    // 2. Secrets Manager (MCP Credentials)
    // ========================================
    const secrets = new SecretsConstruct(this, 'Secrets', {
      userPool: auth.userPool,
      mcpClient: auth.mcpClient,
      cognitoDomain: auth.cognitoDomain,
      removalPolicy,
    });

    // ========================================
    // 3. AgentCore Memory
    // ========================================
    const memory = new MemoryConstruct(this, 'Memory', {
      removalPolicy,
    });

    // ========================================
    // 3b. Aurora MySQL Database
    // ========================================
    const aurora = new AuroraConstruct(this, 'Aurora', {
      removalPolicy,
    });

    // ========================================
    // 4. MCP Servers
    // ========================================
    const mcpServers = new McpServerConstruct(this, 'McpServers', {
      userPool: auth.userPool,
      mcpClient: auth.mcpClient,
      mcpCredentials: secrets.mcpCredentials,
      auroraClusterArn: aurora.cluster.clusterArn,
      auroraSecretArn: aurora.cluster.secret!.secretArn,
      auroraDatabaseName: 'acme_crm',
      removalPolicy,
    });

    // ========================================
    // 4b. OAuth Provider (Token Vault)
    // ========================================
    const oauthProvider = new OAuthProviderConstruct(this, 'OAuthProvider', {
      userPool: auth.userPool,
      mcpClient: auth.mcpClient,
      cognitoDomain: auth.cognitoDomain,
      discoveryUrl: auth.discoveryUrl,
    });

    // ========================================
    // 4c. MCP Gateway
    // ========================================
    const gateway = new GatewayConstruct(this, 'Gateway', {
      userPool: auth.userPool,
      mcpClient: auth.mcpClient,
      mcpServerArns: mcpServers.getArns(),
      oauthProviderArn: oauthProvider.providerArn,
      oauthSecretArn: oauthProvider.secretArn,
      removalPolicy,
    });

    // ========================================
    // 5. Main Agent Runtime
    // ========================================
    const agent = new AgentRuntimeConstruct(this, 'Agent', {
      userPool: auth.userPool,
      frontendClient: auth.frontendClient,
      mcpCredentials: secrets.mcpCredentials,
      memory: memory.memory,
      mcpServerEndpoints: mcpServers.getArns(),
      gatewayUrl: gateway.gateway.gatewayUrl,
      removalPolicy,
    });

    // Grant agent permission to invoke the gateway
    gateway.gateway.grantInvoke(agent.runtime);

    // ========================================
    // 6. Frontend (S3 + CloudFront)
    // ========================================
    const frontend = new FrontendConstruct(this, 'Frontend', {
      userPool: auth.userPool,
      frontendClient: auth.frontendClient,
      agentRuntimeArn: agent.runtime.agentRuntimeArn,
      removalPolicy,
    });

    // ========================================
    // 7. Update Cognito with CloudFront URLs
    // ========================================
    // This must happen after CloudFront is created to resolve the circular dependency
    auth.setFrontendCallbackUrls(frontend.distributionUrl);

    // ========================================
    // Store public properties
    // ========================================
    this.frontendUrl = frontend.distributionUrl;
    this.agentArn = agent.runtime.agentRuntimeArn;
    this.userPoolId = auth.userPool.userPoolId;
    this.frontendClientId = auth.frontendClient.userPoolClientId;

    // ========================================
    // Stack-level outputs
    // ========================================
    new CfnOutput(this, 'FrontendUrl', {
      value: this.frontendUrl,
      description: 'ACME Chat Frontend URL',
      exportName: 'AcmeFrontendUrl',
    });

    new CfnOutput(this, 'AgentArn', {
      value: this.agentArn,
      description: 'Main Agent Runtime ARN',
      exportName: 'AcmeMainAgentArn',
    });

    new CfnOutput(this, 'CognitoUserPoolId', {
      value: this.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: 'AcmeCognitoUserPoolId',
    });

    new CfnOutput(this, 'CognitoAppClientId', {
      value: this.frontendClientId,
      description: 'Cognito Frontend App Client ID',
      exportName: 'AcmeCognitoAppClientId',
    });

    new CfnOutput(this, 'DiscoveryUrl', {
      value: auth.discoveryUrl,
      description: 'Cognito OIDC Discovery URL',
      exportName: 'AcmeCognitoDiscoveryUrl',
    });

    new CfnOutput(this, 'MemoryId', {
      value: memory.memory.memoryId,
      description: 'AgentCore Memory ID',
      exportName: 'AcmeAgentCoreMemoryId',
    });

    // Output deployment summary
    new CfnOutput(this, 'DeploymentSummary', {
      value: JSON.stringify({
        region: Config.aws.region,
        stack: Config.naming.stackName,
        frontendUrl: this.frontendUrl,
        agentArn: this.agentArn,
        userPoolId: this.userPoolId,
        mcpServers: Object.keys(mcpServers.getArns()),
        gatewayId: gateway.gateway.gatewayId,
      }, null, 2),
      description: 'Deployment summary JSON',
    });
  }
}
