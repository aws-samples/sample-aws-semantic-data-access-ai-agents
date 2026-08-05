import * as path from 'path';
import { Construct } from 'constructs';
import { Aws, CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Bucket, BlockPublicAccess, BucketEncryption, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { NagSuppressions } from 'cdk-nag';
import {
  Runtime,
  AgentRuntimeArtifact,
  RuntimeAuthorizerConfiguration,
  RuntimeNetworkConfiguration,
  ProtocolType,
  IMemory,
  RuntimeEndpoint,
} from '@aws-cdk/aws-bedrock-agentcore-alpha';
import {
  PolicyStatement,
  Effect,
} from 'aws-cdk-lib/aws-iam';
import { Config } from '../config';

export interface AgentRuntimeConstructProps {
  readonly userPool: IUserPool;
  readonly frontendClient: IUserPoolClient;
  readonly mcpCredentials: ISecret;
  readonly memory: IMemory;
  readonly mcpServerEndpoints: Record<string, string>;
  readonly gatewayUrl?: string;
  readonly removalPolicy?: RemovalPolicy;
}

export class AgentRuntimeConstruct extends Construct {
  public readonly runtime: Runtime;
  public readonly endpoint: RuntimeEndpoint;
  public readonly visualizationBucket: Bucket;

  constructor(scope: Construct, id: string, props: AgentRuntimeConstructProps) {
    super(scope, id);

    // S3 access logs bucket for visualization bucket
    const vizLogsBucket = new Bucket(this, 'VizLogsBucket', {
      bucketName: `${Config.visualization.bucketPrefix}-logs-${Aws.ACCOUNT_ID}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: props.removalPolicy ?? RemovalPolicy.DESTROY,
      autoDeleteObjects: (props.removalPolicy ?? RemovalPolicy.DESTROY) === RemovalPolicy.DESTROY,
      lifecycleRules: [{ expiration: Duration.days(90) }],
    });

    // Create S3 bucket for code interpreter visualizations
    this.visualizationBucket = new Bucket(this, 'VisualizationBucket', {
      bucketName: `${Config.visualization.bucketPrefix}-${Aws.ACCOUNT_ID}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true, // AwsSolutions-S10
      serverAccessLogsBucket: vizLogsBucket, // AwsSolutions-S1
      serverAccessLogsPrefix: 'viz-bucket-logs/',
      removalPolicy: props.removalPolicy ?? RemovalPolicy.DESTROY,
      autoDeleteObjects: (props.removalPolicy ?? RemovalPolicy.DESTROY) === RemovalPolicy.DESTROY,
      cors: [
        {
          allowedMethods: [HttpMethods.GET, HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        {
          id: 'ExpireVisualizations',
          expiration: Duration.days(Config.visualization.expirationDays),
          prefix: 'visualizations/',
        },
      ],
    });

    const dockerPath = path.join(__dirname, '../../docker/agent');

    // Create the runtime artifact from Docker context
    const artifact = AgentRuntimeArtifact.fromAsset(dockerPath);

    // Build MCP server endpoints as environment variables
    const mcpEndpointEnvVars: Record<string, string> = {};
    for (const [name, endpoint] of Object.entries(props.mcpServerEndpoints)) {
      const envKey = `MCP_SERVER_${name.toUpperCase()}_ENDPOINT`;
      mcpEndpointEnvVars[envKey] = endpoint;
    }

    // Create the main agent runtime
    this.runtime = new Runtime(this, 'MainAgent', {
      runtimeName: Config.agent.runtimeName,
      agentRuntimeArtifact: artifact,
      authorizerConfiguration: RuntimeAuthorizerConfiguration.usingCognito(
        props.userPool,
        [props.frontendClient]
      ),
      networkConfiguration: RuntimeNetworkConfiguration.usingPublicNetwork(),
      protocolConfiguration: ProtocolType.HTTP,
      environmentVariables: {
        AWS_REGION: Config.aws.region,
        AGENT_NAME: Config.agent.runtimeName,
        BEDROCK_MODEL_ID: Config.agent.model,
        MEMORY_ID: props.memory.memoryId,
        DOCKER_CONTAINER: '1',
        VISUALIZATION_BUCKET: this.visualizationBucket.bucketName,
        ...mcpEndpointEnvVars,
        ...(props.gatewayUrl ? { GATEWAY_MCP_URL: props.gatewayUrl } : {}),
      },
    });

    // Create a default endpoint for the runtime
    this.endpoint = this.runtime.addEndpoint('default', {
      description: 'Default endpoint for ACME chatbot',
    });

    // Grant Bedrock model invocation permissions (including inference profiles)
    this.runtime.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: [
          // Inference profiles (global/cross-region)
          `arn:aws:bedrock:${Config.aws.region}:*:inference-profile/*`,
          `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`,
          // Direct model access (fallback)
          `arn:aws:bedrock:${Config.aws.region}::foundation-model/anthropic.claude-*`,
        ],
      })
    );

    // Grant AgentCore Memory permissions
    this.runtime.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'bedrock-agentcore:CreateMemory',
          'bedrock-agentcore:ListMemories',
          'bedrock-agentcore:GetMemory',
          'bedrock-agentcore:DeleteMemory',
          'bedrock-agentcore:CreateEvent',
          'bedrock-agentcore:ListEvents',
          'bedrock-agentcore:GetLastKTurns',
        ],
        resources: ['*'],
      })
    );

    // Grant Secrets Manager access for MCP credentials
    props.mcpCredentials.grantRead(this.runtime);

    // Grant CloudWatch Logs permissions
    this.runtime.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [
          `arn:aws:logs:${Config.aws.region}:*:log-group:/aws/bedrock-agentcore/runtimes/${Config.agent.runtimeName}*`,
          `arn:aws:logs:${Config.aws.region}:*:log-group:/aws/bedrock-agentcore/memory*`,
        ],
      })
    );

    // Grant MCP server invocation permissions
    this.runtime.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'bedrock-agentcore:InvokeAgentRuntime',
        ],
        resources: [`arn:aws:bedrock-agentcore:${Config.aws.region}:*:runtime/*`],
      })
    );

    // Grant Code Interpreter permissions (all code interpreter actions)
    this.runtime.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'bedrock-agentcore:*CodeInterpreter*',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${Config.aws.region}:aws:code-interpreter/*`,
        ],
      })
    );

    // Grant S3 permissions for visualization bucket (upload charts, generate presigned URLs)
    this.runtime.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          's3:PutObject',
          's3:GetObject',
        ],
        resources: [
          `${this.visualizationBucket.bucketArn}/*`,
        ],
      })
    );

    // Outputs
    new CfnOutput(this, 'AgentRuntimeArn', {
      value: this.runtime.agentRuntimeArn,
      description: 'Main Agent Runtime ARN',
      exportName: 'AcmeAgentRuntimeArn',
    });

    new CfnOutput(this, 'AgentRuntimeId', {
      value: this.runtime.agentRuntimeId,
      description: 'Main Agent Runtime ID',
      exportName: 'AcmeAgentRuntimeId',
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions(vizLogsBucket, [
      { id: 'AwsSolutions-S1', reason: 'This is the access logs bucket itself' },
    ]);
    NagSuppressions.addResourceSuppressions(this.runtime, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'AgentCore runtime requires wildcard permissions for Bedrock model invocation, memory, MCP server invocation, code interpreter, and CloudWatch Logs. Resources are scoped to specific service ARN patterns.',
      },
    ], true);
  }
}
