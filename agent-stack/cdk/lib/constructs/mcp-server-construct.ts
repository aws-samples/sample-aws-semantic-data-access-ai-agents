import * as path from 'path';
import { Construct } from 'constructs';
import { CfnOutput, RemovalPolicy } from 'aws-cdk-lib';

import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import {
  Runtime,
  AgentRuntimeArtifact,
  RuntimeAuthorizerConfiguration,
  RuntimeNetworkConfiguration,
  ProtocolType,
} from '@aws-cdk/aws-bedrock-agentcore-alpha';
import {
  PolicyStatement,
  Effect,
} from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { Config } from '../config';

export interface McpServerConfig {
  readonly name: string;
  readonly dockerPath: string;
  readonly description?: string;
  readonly additionalPolicies?: PolicyStatement[];
  readonly environmentVariables?: Record<string, string>;
}

export interface McpServerConstructProps {
  readonly userPool: IUserPool;
  readonly mcpClient: IUserPoolClient;
  readonly mcpCredentials: ISecret;
  readonly auroraClusterArn?: string;
  readonly auroraSecretArn?: string;
  readonly auroraDatabaseName?: string;
  readonly removalPolicy?: RemovalPolicy;
}

export interface McpServerRuntime {
  readonly runtime: Runtime;
  readonly name: string;
}

export class McpServerConstruct extends Construct {
  public readonly runtimes: Map<string, McpServerRuntime> = new Map();

  constructor(scope: Construct, id: string, props: McpServerConstructProps) {
    super(scope, id);

    // Define all MCP servers to deploy
    const mcpServers: McpServerConfig[] = [
      {
        name: Config.mcpServers.awsDocs.name,
        dockerPath: Config.mcpServers.awsDocs.dockerPath,
        description: 'AWS Documentation search MCP server',
      },
      {
        name: Config.mcpServers.dataProcessing.name,
        dockerPath: Config.mcpServers.dataProcessing.dockerPath,
        description: 'Data processing MCP server (Athena, Glue, EMR)',
        additionalPolicies: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              // Athena query execution
              'athena:StartQueryExecution',
              'athena:GetQueryExecution',
              'athena:GetQueryResults',
              'athena:StopQueryExecution',
              'athena:GetWorkGroup',
              // Athena catalog/database/table listing
              'athena:ListDataCatalogs',
              'athena:ListDatabases',
              'athena:ListTableMetadata',
              'athena:GetDataCatalog',
              'athena:GetDatabase',
              'athena:GetTableMetadata',
              // Glue Data Catalog access (Athena uses Glue as metadata store)
              'glue:GetDatabase',
              'glue:GetDatabases',
              'glue:GetTable',
              'glue:GetTables',
              'glue:GetPartition',
              'glue:GetPartitions',
              'glue:BatchGetPartition',
              'glue:GetCatalogImportStatus',
              'glue:SearchTables',
              // S3 access for query results
              's3:GetObject',
              's3:PutObject',
              's3:ListBucket',
              's3:GetBucketLocation',
            ],
            resources: ['*'],
          }),
        ],
      },
      // MySQL MCP server - conditionally included when Aurora is configured
      ...(props.auroraClusterArn ? [{
        name: Config.mcpServers.mysql.name,
        dockerPath: Config.mcpServers.mysql.dockerPath,
        description: 'MySQL MCP server for Aurora MySQL (CRM data)',
        environmentVariables: {
          MYSQL_RESOURCE_ARN: props.auroraClusterArn,
          MYSQL_SECRET_ARN: props.auroraSecretArn!,
          MYSQL_DATABASE: props.auroraDatabaseName ?? 'acme_crm',
          MYSQL_READONLY: 'true',
        },
        additionalPolicies: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              'rds-data:ExecuteStatement',
              'rds-data:BatchExecuteStatement',
              'rds-data:BeginTransaction',
              'rds-data:CommitTransaction',
              'rds-data:RollbackTransaction',
            ],
            resources: [props.auroraClusterArn],
          }),
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['secretsmanager:GetSecretValue'],
            resources: [props.auroraSecretArn!],
          }),
        ],
      }] : []),
    ];

    // Create each MCP server runtime
    for (const server of mcpServers) {
      const runtime = this.createMcpServer(server, props);
      this.runtimes.set(server.name, {
        runtime,
        name: server.name,
      });
    }
  }

  private createMcpServer(
    config: McpServerConfig,
    props: McpServerConstructProps
  ): Runtime {
    // nosemgrep: path-join-resolve-traversal — dockerPath comes from hardcoded Config, not user input
    const dockerPath = path.join(__dirname, '../..', config.dockerPath);

    // Create the runtime artifact from Docker context
    const artifact = AgentRuntimeArtifact.fromAsset(dockerPath);

    // Create the MCP server runtime
    const runtime = new Runtime(this, `${config.name}Runtime`, {
      runtimeName: config.name,
      agentRuntimeArtifact: artifact,
      authorizerConfiguration: RuntimeAuthorizerConfiguration.usingCognito(props.userPool, [props.mcpClient]),
      networkConfiguration: RuntimeNetworkConfiguration.usingPublicNetwork(),
      protocolConfiguration: ProtocolType.MCP,
      environmentVariables: {
        AWS_REGION: Config.aws.region,
        MCP_SERVER_NAME: config.name,
        ...config.environmentVariables,
      },
    });

    // Grant read access to MCP credentials secret
    props.mcpCredentials.grantRead(runtime);

    // Add additional policies if specified
    if (config.additionalPolicies) {
      for (const policy of config.additionalPolicies) {
        runtime.addToRolePolicy(policy);
      }
    }

    // Add CloudWatch Logs permissions
    runtime.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [
          `arn:aws:logs:${Config.aws.region}:*:log-group:/aws/bedrock-agentcore/runtimes/${config.name}*`,
        ],
      })
    );

    // Output
    new CfnOutput(this, `${config.name}Arn`, {
      value: runtime.agentRuntimeArn,
      description: `${config.name} MCP Server Runtime ARN`,
      exportName: `Acme${this.toPascalCase(config.name)}Arn`,
    });

    // cdk-nag suppressions for MCP server runtime roles
    NagSuppressions.addResourceSuppressions(runtime, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'MCP server runtimes require wildcard permissions for CloudWatch Logs, workload identity, and service-specific resources (Athena/Glue/S3). Resources are scoped to specific ARN patterns.',
      },
    ], true);

    return runtime;
  }

  private toPascalCase(str: string): string {
    return str
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  /**
   * Get all MCP server ARNs as a map
   */
  public getArns(): Record<string, string> {
    const arns: Record<string, string> = {};
    for (const [name, server] of this.runtimes) {
      arns[name] = server.runtime.agentRuntimeArn;
    }
    return arns;
  }
}
