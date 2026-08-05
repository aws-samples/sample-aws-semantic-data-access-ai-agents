import { Construct } from 'constructs';
import {
  Duration,
  RemovalPolicy,
  CfnOutput,
  Stack,
} from 'aws-cdk-lib';
import {
  UserPool,
  UserPoolClient,
  CfnUserPoolClient,
  AccountRecovery,
  Mfa,
  AdvancedSecurityMode,
  StringAttribute,
  UserPoolClientIdentityProvider,
  OAuthScope,
  ResourceServerScope,
  IUserPool,
  IUserPoolClient,
} from 'aws-cdk-lib/aws-cognito';
import { NagSuppressions } from 'cdk-nag';
import { Config } from '../config';

export interface CognitoConstructProps {
  readonly removalPolicy?: RemovalPolicy;
}

export class CognitoConstruct extends Construct {
  public readonly userPool: IUserPool;
  public readonly frontendClient: IUserPoolClient;
  public readonly mcpClient: IUserPoolClient;
  public readonly discoveryUrl: string;
  public readonly cognitoDomain: string;
  private readonly frontendCfnClient: CfnUserPoolClient;

  constructor(scope: Construct, id: string, props?: CognitoConstructProps) {
    super(scope, id);

    const removalPolicy = props?.removalPolicy ?? RemovalPolicy.DESTROY;

    // Create Cognito User Pool
    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: Config.cognito.userPoolName,
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: false,
          mutable: true,
        },
        familyName: {
          required: false,
          mutable: true,
        },
      },
      customAttributes: {
        department: new StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: Config.cognito.passwordPolicy.minLength,
        requireUppercase: Config.cognito.passwordPolicy.requireUppercase,
        requireLowercase: Config.cognito.passwordPolicy.requireLowercase,
        requireDigits: Config.cognito.passwordPolicy.requireDigits,
        requireSymbols: Config.cognito.passwordPolicy.requireSymbols,
        tempPasswordValidity: Duration.days(Config.cognito.passwordPolicy.tempPasswordValidityDays),
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      mfa: Mfa.OPTIONAL,
      advancedSecurityMode: AdvancedSecurityMode.ENFORCED, // AwsSolutions-COG3
      removalPolicy: removalPolicy,
    });

    // Frontend App Client (public, no secret - for React app)
    // Note: OAuth callback URLs are set later by setFrontendCallbackUrls() after CloudFront is created
    this.frontendClient = this.userPool.addClient('FrontendClient', {
      userPoolClientName: Config.cognito.frontendClientName,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true, // For testing purposes
        custom: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true, // Use code flow for PKCE (not implicit)
        },
        scopes: [
          OAuthScope.EMAIL,
          OAuthScope.OPENID,
          OAuthScope.PROFILE,
        ],
        // Callback URLs will be set after CloudFront is created
        callbackUrls: ['https://localhost:3000/callback'], // Placeholder for local dev
        logoutUrls: ['https://localhost:3000'],
      },
      supportedIdentityProviders: [
        UserPoolClientIdentityProvider.COGNITO,
      ],
      idTokenValidity: Duration.hours(Config.cognito.tokenValidity.idToken),
      accessTokenValidity: Duration.hours(Config.cognito.tokenValidity.accessToken),
      refreshTokenValidity: Duration.days(Config.cognito.tokenValidity.refreshToken),
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
    });

    // Get the underlying CfnUserPoolClient for later callback URL updates
    this.frontendCfnClient = this.frontendClient.node.defaultChild as CfnUserPoolClient;

    // Add a domain for OAuth flows (required for client credentials)
    // Domain prefix must be globally unique across all AWS accounts
    const domainPrefix = `${Config.naming.projectPrefix}-agentcore-${Stack.of(this).account}`;
    const userPoolDomain = (this.userPool as UserPool).addDomain('Domain', {
      cognitoDomain: {
        domainPrefix: domainPrefix,
      },
    });

    // Set the full domain for OAuth token requests
    this.cognitoDomain = `${domainPrefix}.auth.${Config.aws.region}.amazoncognito.com`;

    // Create Resource Server for MCP scopes
    const mcpResourceServer = (this.userPool as UserPool).addResourceServer('McpResourceServer', {
      identifier: 'mcp',
      userPoolResourceServerName: 'MCP Resource Server',
      scopes: [
        new ResourceServerScope({
          scopeName: 'invoke',
          scopeDescription: 'Invoke MCP server endpoints',
        }),
      ],
    });

    // MCP App Client (confidential, with secret - for M2M auth)
    this.mcpClient = this.userPool.addClient('McpClient', {
      userPoolClientName: Config.cognito.mcpClientName,
      generateSecret: true,
      authFlows: {
        userSrp: true,
        custom: true,
      },
      oAuth: {
        flows: {
          clientCredentials: true,
        },
        scopes: [
          OAuthScope.resourceServer(mcpResourceServer, new ResourceServerScope({
            scopeName: 'invoke',
            scopeDescription: 'Invoke MCP server endpoints',
          })),
        ],
      },
      supportedIdentityProviders: [
        UserPoolClientIdentityProvider.COGNITO,
      ],
      idTokenValidity: Duration.hours(Config.cognito.tokenValidity.idToken),
      accessTokenValidity: Duration.hours(Config.cognito.tokenValidity.accessToken),
      refreshTokenValidity: Duration.days(Config.cognito.tokenValidity.refreshToken),
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
    });

    // Build discovery URL
    this.discoveryUrl = `https://cognito-idp.${Config.aws.region}.amazonaws.com/${this.userPool.userPoolId}/.well-known/openid-configuration`;

    // Outputs
    new CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: 'AcmeUserPoolId',
    });

    new CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN',
      exportName: 'AcmeUserPoolArn',
    });

    new CfnOutput(this, 'FrontendClientId', {
      value: this.frontendClient.userPoolClientId,
      description: 'Frontend App Client ID',
      exportName: 'AcmeFrontendClientId',
    });

    new CfnOutput(this, 'McpClientId', {
      value: this.mcpClient.userPoolClientId,
      description: 'MCP App Client ID',
      exportName: 'AcmeMcpClientId',
    });

    new CfnOutput(this, 'DiscoveryUrl', {
      value: this.discoveryUrl,
      description: 'Cognito OIDC Discovery URL',
      exportName: 'AcmeDiscoveryUrl',
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions(this.userPool, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Cognito SMS role requires Resource::* for SNS publish — this is CDK-generated and cannot be scoped further',
      },
    ], true);
  }

  /**
   * Set the frontend callback URLs after CloudFront distribution is created.
   * This solves the circular dependency: Cognito needs CloudFront URL, but
   * CloudFront is created after Cognito.
   *
   * @param frontendUrl The CloudFront distribution URL (e.g., https://d123.cloudfront.net)
   */
  public setFrontendCallbackUrls(frontendUrl: string): void {
    this.frontendCfnClient.callbackUrLs = [
      frontendUrl,
      `${frontendUrl}/callback`,
      'http://localhost:3000',
      'http://localhost:3000/callback',
    ];
    this.frontendCfnClient.logoutUrLs = [
      frontendUrl,
      'http://localhost:3000',
    ];
  }
}
