import * as path from 'path';
import { Construct } from 'constructs';
import {
  Aws,
  Duration,
  RemovalPolicy,
  CfnOutput,
  Stack,
} from 'aws-cdk-lib';
import {
  Bucket,
  BlockPublicAccess,
  BucketEncryption,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import {
  Distribution,
  OriginAccessIdentity,
  AllowedMethods,
  ViewerProtocolPolicy,
  CachePolicy,
  OriginRequestPolicy,
  PriceClass,
  SecurityPolicyProtocol,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { NagSuppressions } from 'cdk-nag';
import { Config } from '../config';

export interface FrontendConstructProps {
  readonly userPool: IUserPool;
  readonly frontendClient: IUserPoolClient;
  readonly agentRuntimeArn: string;
  readonly removalPolicy?: RemovalPolicy;
}

export class FrontendConstruct extends Construct {
  public readonly distribution: Distribution;
  public readonly bucket: Bucket;
  public readonly distributionUrl: string;

  constructor(scope: Construct, id: string, props: FrontendConstructProps) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? RemovalPolicy.DESTROY;

    // S3 access logs bucket (AwsSolutions-S1)
    const accessLogsBucket = new Bucket(this, 'AccessLogsBucket', {
      bucketName: `${Config.frontend.bucketNamePrefix}-access-logs-${Aws.ACCOUNT_ID}-${Aws.REGION}`,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: [{ expiration: Duration.days(90) }],
    });

    // CloudFront access logs bucket (AwsSolutions-CFR3)
    const cfLogsBucket = new Bucket(this, 'CloudFrontLogsBucket', {
      bucketName: `${Config.frontend.bucketNamePrefix}-cf-logs-${Aws.ACCOUNT_ID}-${Aws.REGION}`,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      removalPolicy: removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: [{ expiration: Duration.days(90) }],
    });

    // Create S3 bucket for hosting React app (private access only)
    this.bucket = new Bucket(this, 'WebsiteBucket', {
      bucketName: `${Config.frontend.bucketNamePrefix}-${Aws.ACCOUNT_ID}-${Aws.REGION}`,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true, // AwsSolutions-S10
      serverAccessLogsBucket: accessLogsBucket, // AwsSolutions-S1
      serverAccessLogsPrefix: 'website-bucket-logs/',
      removalPolicy: removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
    });

    // Create Origin Access Identity for CloudFront to access S3
    const originAccessIdentity = new OriginAccessIdentity(this, 'OAI', {
      comment: 'OAI for ACME Chat Frontend',
    });

    // Grant CloudFront OAI read access to the S3 bucket
    this.bucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [this.bucket.arnForObjects('*')],
        principals: [originAccessIdentity.grantPrincipal],
      })
    );

    // Create static assets cache policy
    const staticAssetsCachePolicy = new CachePolicy(this, 'StaticAssetsCachePolicy', {
      cachePolicyName: `${Config.naming.projectPrefix}-static-assets`,
      comment: 'Cache policy for static assets',
      defaultTtl: Duration.days(Config.frontend.cachePolicy.staticAssetsTtlDays),
      maxTtl: Duration.days(Config.frontend.cachePolicy.staticAssetsMaxTtlDays),
      minTtl: Duration.seconds(0),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });

    // Create CloudFront distribution
    this.distribution = new Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021, // AwsSolutions-CFR4
      enableLogging: true, // AwsSolutions-CFR3
      logBucket: cfLogsBucket,
      logFilePrefix: 'cf-access-logs/',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(30),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(30),
        },
      ],
      defaultBehavior: {
        origin: new S3Origin(this.bucket, {
          originAccessIdentity: originAccessIdentity,
        }),
        compress: true,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: OriginRequestPolicy.CORS_S3_ORIGIN,
      },
      additionalBehaviors: {
        '/static/*': {
          origin: new S3Origin(this.bucket, {
            originAccessIdentity: originAccessIdentity,
          }),
          compress: true,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: staticAssetsCachePolicy,
        },
      },
      priceClass: PriceClass.PRICE_CLASS_100,
      enabled: true,
      comment: 'ACME Chat Frontend Distribution',
    });

    this.distributionUrl = `https://${this.distribution.distributionDomainName}`;

    // Deploy React build to S3
    const buildPath = path.join(__dirname, '../..', Config.frontend.buildPath);
    new BucketDeployment(this, 'Deployment', {
      sources: [Source.asset(buildPath)],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    // Outputs
    new CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront Distribution Domain Name',
      exportName: 'AcmeChatDistributionDomainName',
    });

    new CfnOutput(this, 'DistributionUrl', {
      value: this.distributionUrl,
      description: 'CloudFront Distribution URL',
      exportName: 'AcmeChatDistributionUrl',
    });

    new CfnOutput(this, 'S3BucketName', {
      value: this.bucket.bucketName,
      description: 'S3 Bucket Name for Frontend Assets',
      exportName: 'AcmeChatS3BucketName',
    });

    new CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront Distribution ID',
      exportName: 'AcmeChatDistributionId',
    });

    // Output frontend configuration for reference
    new CfnOutput(this, 'FrontendConfig', {
      value: JSON.stringify({
        userPoolId: props.userPool.userPoolId,
        clientId: props.frontendClient.userPoolClientId,
        region: Config.aws.region,
        agentArn: props.agentRuntimeArn,
        agentEndpoint: `https://bedrock-agentcore.${Config.aws.region}.amazonaws.com`,
      }),
      description: 'Frontend configuration JSON',
      exportName: 'AcmeChatFrontendConfig',
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions(accessLogsBucket, [
      { id: 'AwsSolutions-S1', reason: 'This is the access logs bucket itself' },
    ]);
    NagSuppressions.addResourceSuppressions(cfLogsBucket, [
      { id: 'AwsSolutions-S1', reason: 'This is the CloudFront logs bucket itself' },
    ]);
    NagSuppressions.addResourceSuppressions(this.distribution, [
      { id: 'AwsSolutions-CFR7', reason: 'Using OAI for S3 origin access — OAC migration is planned but not blocking' },
      { id: 'AwsSolutions-CFR4', reason: 'TLS 1.2 minimum requires a custom domain with ACM certificate. Default *.cloudfront.net cert enforces TLSv1 minimum regardless of MinimumProtocolVersion setting.' },
    ]);
    NagSuppressions.addStackSuppressions(Stack.of(this), [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'CDK BucketDeployment and auto-delete custom resources require AWSLambdaBasicExecutionRole',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'CDK BucketDeployment and auto-delete custom resources require wildcard permissions on managed buckets',
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'CDK BucketDeployment and auto-delete custom resources control their own Lambda runtime versions',
      },
    ]);
  }
}
