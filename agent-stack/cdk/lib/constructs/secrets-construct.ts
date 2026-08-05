import { Construct } from 'constructs';
import { RemovalPolicy, CfnOutput, CustomResource, Duration } from 'aws-cdk-lib';
import { Secret, ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Runtime, Code, Function } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { Config } from '../config';

export interface SecretsConstructProps {
  readonly userPool: IUserPool;
  readonly mcpClient: IUserPoolClient;
  readonly cognitoDomain: string;
  readonly removalPolicy?: RemovalPolicy;
}

export class SecretsConstruct extends Construct {
  public readonly mcpCredentials: ISecret;

  constructor(scope: Construct, id: string, props: SecretsConstructProps) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? RemovalPolicy.DESTROY;

    // Create secret for MCP credentials (initially with placeholder)
    // The Custom Resource below will update it with the actual Cognito client secret
    this.mcpCredentials = new Secret(this, 'McpCredentials', {
      secretName: Config.secrets.mcpCredentialsName,
      description: 'MCP Server credentials for ACME chatbot',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          MCP_COGNITO_POOL_ID: props.userPool.userPoolId,
          MCP_COGNITO_REGION: Config.aws.region,
          MCP_COGNITO_CLIENT_ID: props.mcpClient.userPoolClientId,
          MCP_COGNITO_DOMAIN: props.cognitoDomain,
        }),
        generateStringKey: 'MCP_COGNITO_CLIENT_SECRET',
      },
      removalPolicy: removalPolicy,
    });

    // Lambda function to sync the actual Cognito client secret to Secrets Manager
    const syncClientSecretFn = new Function(this, 'SyncClientSecretFn', {
      runtime: Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: Duration.seconds(30),
      code: Code.fromInline(`
import boto3
import json
import cfnresponse

def handler(event, context):
    try:
        if event['RequestType'] == 'Delete':
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
            return

        props = event['ResourceProperties']
        user_pool_id = props['UserPoolId']
        client_id = props['ClientId']
        secret_arn = props['SecretArn']
        cognito_domain = props['CognitoDomain']
        region = props['Region']

        # Get the actual Cognito client secret
        cognito = boto3.client('cognito-idp')
        response = cognito.describe_user_pool_client(
            UserPoolId=user_pool_id,
            ClientId=client_id
        )
        client_secret = response['UserPoolClient'].get('ClientSecret', '')

        # Build the complete secret value
        secret_value = json.dumps({
            'MCP_COGNITO_POOL_ID': user_pool_id,
            'MCP_COGNITO_REGION': region,
            'MCP_COGNITO_CLIENT_ID': client_id,
            'MCP_COGNITO_DOMAIN': cognito_domain,
            'MCP_COGNITO_CLIENT_SECRET': client_secret,
        })

        # Update the secret with the actual client secret
        sm = boto3.client('secretsmanager')
        sm.put_secret_value(
            SecretId=secret_arn,
            SecretString=secret_value
        )

        cfnresponse.send(event, context, cfnresponse.SUCCESS, {
            'Message': 'Secret synced successfully'
        })
    except Exception as e:
        print(f"Error: {e}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {'Error': str(e)})
`),
    });

    // Grant permissions
    syncClientSecretFn.addToRolePolicy(new PolicyStatement({
      actions: ['cognito-idp:DescribeUserPoolClient'],
      resources: [props.userPool.userPoolArn],
    }));
    syncClientSecretFn.addToRolePolicy(new PolicyStatement({
      actions: ['secretsmanager:PutSecretValue'],
      resources: [this.mcpCredentials.secretArn],
    }));

    // Create provider for the custom resource
    const provider = new Provider(this, 'SyncClientSecretProvider', {
      onEventHandler: syncClientSecretFn,
    });

    // Custom resource to sync the Cognito client secret to Secrets Manager
    // This runs on every deployment to ensure the secret is always up-to-date
    const syncSecretResource = new CustomResource(this, 'SyncClientSecret', {
      serviceToken: provider.serviceToken,
      properties: {
        UserPoolId: props.userPool.userPoolId,
        ClientId: props.mcpClient.userPoolClientId,
        SecretArn: this.mcpCredentials.secretArn,
        CognitoDomain: props.cognitoDomain,
        Region: Config.aws.region,
        // Force re-run on every deployment by including a timestamp
        // This ensures the secret is always synced and SyncVersion is returned
        DeployTimestamp: Date.now().toString(),
      },
    });

    // Ensure sync happens after secret is created
    syncSecretResource.node.addDependency(this.mcpCredentials);

    // Output
    new CfnOutput(this, 'McpCredentialsArn', {
      value: this.mcpCredentials.secretArn,
      description: 'MCP Credentials Secret ARN',
      exportName: 'AcmeMcpCredentialsArn',
    });

    new CfnOutput(this, 'McpCredentialsName', {
      value: this.mcpCredentials.secretName,
      description: 'MCP Credentials Secret Name',
      exportName: 'AcmeMcpCredentialsName',
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions(this.mcpCredentials, [
      { id: 'AwsSolutions-SMG4', reason: 'MCP credentials are synced from Cognito client secret on each deploy — automatic rotation is not applicable' },
    ]);
    NagSuppressions.addResourceSuppressions(syncClientSecretFn, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWSLambdaBasicExecutionRole is required for CloudWatch Logs',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      },
    ], true);
    NagSuppressions.addResourceSuppressions(provider, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'CDK Provider framework Lambda requires AWSLambdaBasicExecutionRole',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      },
      { id: 'AwsSolutions-IAM5', reason: 'CDK Provider framework requires invoke permission with :* suffix on handler Lambda' },
      { id: 'AwsSolutions-L1', reason: 'CDK Provider framework controls the Lambda runtime version' },
    ], true);
  }
}
