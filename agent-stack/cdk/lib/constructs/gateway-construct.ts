import { Construct } from 'constructs';
import { Fn, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import {
  Gateway,
  GatewayAuthorizer,
  GatewayProtocol,
  McpGatewaySearchType,
  MCPProtocolVersion,
  GatewayCredentialProvider,
  GatewayExceptionLevel,
} from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { Config } from '../config';

export interface GatewayConstructProps {
  readonly userPool: IUserPool;
  readonly mcpClient: IUserPoolClient;
  readonly mcpServerArns: Record<string, string>;
  /** OAuth credential provider ARN from the Token Vault */
  readonly oauthProviderArn: string;
  /** Secrets Manager ARN for the OAuth credentials */
  readonly oauthSecretArn: string;
  readonly removalPolicy?: RemovalPolicy;
}

export class GatewayConstruct extends Construct {
  public readonly gateway: Gateway;

  constructor(scope: Construct, id: string, props: GatewayConstructProps) {
    super(scope, id);

    this.gateway = new Gateway(this, 'McpGateway', {
      gatewayName: Config.gateway.name,
      description: Config.gateway.description,
      protocolConfiguration: GatewayProtocol.mcp({
        instructions: Config.gateway.instructions,
        searchType: McpGatewaySearchType.SEMANTIC,
        supportedVersions: [MCPProtocolVersion.MCP_2025_03_26],
      }),
      authorizerConfiguration: GatewayAuthorizer.usingCognito({
        userPool: props.userPool,
        allowedClients: [props.mcpClient],
      }),
      exceptionLevel: GatewayExceptionLevel.DEBUG,
    });

    for (const [name, arn] of Object.entries(props.mcpServerArns)) {
      // Sanitize name: Gateway target names only allow alphanumeric and hyphens
      const targetName = name.replace(/_/g, '-');

      const slashEncoded = Fn.join('%2F', Fn.split('/', arn));
      const fullyEncoded = Fn.join('%3A', Fn.split(':', slashEncoded));

      const endpointUrl = Fn.join('', [
        `https://bedrock-agentcore.${Config.aws.region}.amazonaws.com/runtimes/`,
        fullyEncoded,
        '/invocations?qualifier=DEFAULT',
      ]);

      this.gateway.addMcpServerTarget(`${targetName}Target`, {
        gatewayTargetName: targetName,
        description: `MCP target for ${name}`,
        endpoint: endpointUrl,
        credentialProviderConfigurations: [
          GatewayCredentialProvider.fromOauthIdentityArn({
            providerArn: props.oauthProviderArn,
            secretArn: props.oauthSecretArn,
            scopes: ['mcp/invoke'],
          }),
        ],
      });
    }

    this.gateway.role.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [`arn:aws:bedrock-agentcore:${Config.aws.region}:*:runtime/*`],
      })
    );

    // Gateway OAuth flow: GetWorkloadAccessToken (step 1) + GetResourceOauth2Token (step 2)
    this.gateway.role.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'bedrock-agentcore:GetWorkloadAccessToken',
          'bedrock-agentcore:GetResourceOauth2Token',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${Config.aws.region}:*:workload-identity-directory/*`,
          `arn:aws:bedrock-agentcore:${Config.aws.region}:*:token-vault/*`,
        ],
      })
    );

    // Gateway needs to read OAuth client secret from Secrets Manager
    this.gateway.role.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${Config.aws.region}:*:secret:*`],
      })
    );

    new CfnOutput(this, 'GatewayArn', {
      value: this.gateway.gatewayArn,
      description: 'ACME MCP Gateway ARN',
      exportName: 'AcmeMcpGatewayArn',
    });

    new CfnOutput(this, 'GatewayId', {
      value: this.gateway.gatewayId,
      description: 'ACME MCP Gateway ID',
      exportName: 'AcmeMcpGatewayId',
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions(this.gateway, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Gateway requires wildcard permissions for runtime invocation, workload identity, token vault, and secrets manager. Resource ARNs are dynamically created and cannot be known at deploy time.',
      },
    ], true);
  }
}
