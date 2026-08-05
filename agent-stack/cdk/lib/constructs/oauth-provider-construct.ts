import { Construct } from 'constructs';
import { CustomResource, Duration, CfnOutput } from 'aws-cdk-lib';
import { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Runtime as LambdaRuntime, Code, Function } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { Config } from '../config';

export interface OAuthProviderConstructProps {
  readonly userPool: IUserPool;
  readonly mcpClient: IUserPoolClient;
  readonly cognitoDomain: string;
  readonly discoveryUrl: string;
}

/**
 * Creates an OAuth2 credential provider in the Bedrock AgentCore Token Vault.
 * This is required for MCP Gateway targets which only support OAuth outbound auth.
 */
export class OAuthProviderConstruct extends Construct {
  public readonly providerArn: string;
  public readonly secretArn: string;

  constructor(scope: Construct, id: string, props: OAuthProviderConstructProps) {
    super(scope, id);

    const providerName = `${Config.naming.projectPrefix}-mcp-oauth`;

    // Lambda function to create/update/delete the OAuth2 credential provider
    // Note: When using CDK Provider, return a dict instead of calling cfnresponse.send
    const oauthProviderFn = new Function(this, 'OAuthProviderFn', {
      runtime: LambdaRuntime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: Duration.seconds(60),
      code: Code.fromInline(`
import boto3
import json

def handler(event, context):
    request_type = event['RequestType']
    props = event['ResourceProperties']
    provider_name = props['ProviderName']
    region = props['Region']

    agentcore = boto3.client('bedrock-agentcore-control', region_name=region)

    if request_type == 'Delete':
        try:
            agentcore.delete_oauth2_credential_provider(name=provider_name)
            print(f"Deleted OAuth2 provider: {provider_name}")
        except agentcore.exceptions.ResourceNotFoundException:
            print(f"OAuth2 provider {provider_name} not found, skipping delete")
        except Exception as e:
            print(f"Error deleting OAuth2 provider (non-fatal): {e}")
        return {}

    user_pool_id = props['UserPoolId']
    client_id = props['ClientId']
    discovery_url = props['DiscoveryUrl']

    # Get the Cognito client secret
    cognito = boto3.client('cognito-idp', region_name=region)
    response = cognito.describe_user_pool_client(
        UserPoolId=user_pool_id,
        ClientId=client_id
    )
    client_secret = response['UserPoolClient'].get('ClientSecret', '')

    if not client_secret:
        raise Exception('MCP client has no client secret configured')

    oauth_config = {
        'customOauth2ProviderConfig': {
            'oauthDiscovery': {
                'discoveryUrl': discovery_url,
            },
            'clientId': client_id,
            'clientSecret': client_secret,
        }
    }

    provider_arn = ''
    secret_arn = ''

    if request_type in ('Create', 'Update'):
        # Check if provider already exists
        try:
            existing = agentcore.get_oauth2_credential_provider(name=provider_name)
            # Provider exists, update it
            print(f"OAuth2 provider {provider_name} already exists, updating...")
            result = agentcore.update_oauth2_credential_provider(
                name=provider_name,
                credentialProviderVendor='CustomOauth2',
                oauth2ProviderConfigInput=oauth_config,
            )
            provider_arn = existing.get('credentialProviderArn', '')
            secret_arn = existing.get('clientSecretArn', {}).get('secretArn', '')
        except agentcore.exceptions.ResourceNotFoundException:
            # Create new provider
            print(f"Creating OAuth2 provider: {provider_name}")
            result = agentcore.create_oauth2_credential_provider(
                name=provider_name,
                credentialProviderVendor='CustomOauth2',
                oauth2ProviderConfigInput=oauth_config,
            )
            provider_arn = result.get('credentialProviderArn', '')
            secret_arn = result.get('clientSecretArn', {}).get('secretArn', '')

    if not provider_arn or not secret_arn:
        # Fetch again to make sure we have the ARNs
        existing = agentcore.get_oauth2_credential_provider(name=provider_name)
        provider_arn = existing.get('credentialProviderArn', '')
        secret_arn = existing.get('clientSecretArn', {}).get('secretArn', '')

    print(f"OAuth2 provider ARN: {provider_arn}")
    print(f"OAuth2 secret ARN: {secret_arn}")

    if not provider_arn or not secret_arn:
        raise Exception(f"Failed to get OAuth2 provider ARNs. provider_arn={provider_arn}, secret_arn={secret_arn}")

    return {
        'Data': {
            'ProviderArn': provider_arn,
            'SecretArn': secret_arn,
        }
    }
`),
    });

    // Grant permissions - broader permissions for token vault and secrets operations
    oauthProviderFn.addToRolePolicy(new PolicyStatement({
      actions: ['cognito-idp:DescribeUserPoolClient'],
      resources: [props.userPool.userPoolArn],
    }));
    oauthProviderFn.addToRolePolicy(new PolicyStatement({
      actions: [
        'bedrock-agentcore:CreateOauth2CredentialProvider',
        'bedrock-agentcore:UpdateOauth2CredentialProvider',
        'bedrock-agentcore:DeleteOauth2CredentialProvider',
        'bedrock-agentcore:GetOauth2CredentialProvider',
        'bedrock-agentcore:CreateTokenVault',
        'bedrock-agentcore:GetTokenVault',
      ],
      resources: ['*'],
    }));
    // CreateOauth2CredentialProvider internally creates a Secrets Manager secret
    oauthProviderFn.addToRolePolicy(new PolicyStatement({
      actions: [
        'secretsmanager:CreateSecret',
        'secretsmanager:UpdateSecret',
        'secretsmanager:DeleteSecret',
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
        'secretsmanager:PutSecretValue',
      ],
      resources: ['*'],
    }));

    const provider = new Provider(this, 'OAuthProviderProvider', {
      onEventHandler: oauthProviderFn,
    });

    const oauthResource = new CustomResource(this, 'OAuthProviderResource', {
      serviceToken: provider.serviceToken,
      properties: {
        ProviderName: providerName,
        UserPoolId: props.userPool.userPoolId,
        ClientId: props.mcpClient.userPoolClientId,
        DiscoveryUrl: props.discoveryUrl,
        Region: Config.aws.region,
        // Force re-run on every deployment to keep credentials in sync
        DeployTimestamp: Date.now().toString(),
      },
    });

    this.providerArn = oauthResource.getAttString('ProviderArn');
    this.secretArn = oauthResource.getAttString('SecretArn');

    new CfnOutput(this, 'OAuthProviderArn', {
      value: this.providerArn,
      description: 'OAuth2 Credential Provider ARN for MCP Gateway',
      exportName: 'AcmeOAuthProviderArn',
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions(oauthProviderFn, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWSLambdaBasicExecutionRole is required for CloudWatch Logs',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'OAuth provider Lambda needs wildcard on bedrock-agentcore and secretsmanager because resource ARNs are not known at deploy time (created dynamically by the Token Vault)',
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
