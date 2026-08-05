import { Construct } from 'constructs';
import { RemovalPolicy, CfnOutput, Duration, CustomResource } from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { Config } from '../config';

export interface AuroraConstructProps {
  readonly removalPolicy?: RemovalPolicy;
}

export class AuroraConstruct extends Construct {
  public readonly cluster: rds.DatabaseCluster;
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props?: AuroraConstructProps) {
    super(scope, id);

    const removalPolicy = props?.removalPolicy ?? RemovalPolicy.DESTROY;

    // Use existing default VPC (4 subnets across us-west-2a/b/c/d)
    this.vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // Security group - only needs internal VPC access (Data API handles external)
    const sg = new ec2.SecurityGroup(this, 'AuroraSg', {
      vpc: this.vpc,
      description: 'Aurora MySQL Serverless v2',
      allowAllOutbound: false,
    });
    sg.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(3307), 'MySQL from VPC');

    // Aurora MySQL Serverless v2 with Data API
    this.cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_08_0,
      }),
      writer: rds.ClusterInstance.serverlessV2('writer', {
        publiclyAccessible: false,
      }),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [sg],
      credentials: rds.Credentials.fromGeneratedSecret('admin', {
        secretName: 'acme-aurora-mysql-credentials',
      }),
      defaultDatabaseName: 'acme_crm',
      enableDataApi: true,
      storageEncrypted: true,
      iamAuthentication: true, // AwsSolutions-RDS6
      deletionProtection: removalPolicy !== RemovalPolicy.DESTROY, // AwsSolutions-RDS10
      port: 3307, // AwsSolutions-RDS11: non-default port
      removalPolicy,
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
    });

    // Database initialization Lambda (uses Data API - no VPC needed)
    const initFn = new lambda.Function(this, 'AuroraInitFn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/aurora-init')),
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: {
        AWS_REGION_NAME: Config.aws.region,
      },
    });

    // Grant Data API and Secrets Manager access
    initFn.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['rds-data:ExecuteStatement', 'rds-data:BatchExecuteStatement'],
      resources: [this.cluster.clusterArn],
    }));
    this.cluster.secret!.grantRead(initFn);

    const initProvider = new cr.Provider(this, 'AuroraInitProvider', {
      onEventHandler: initFn,
    });

    const auroraInit = new CustomResource(this, 'AuroraInit', {
      serviceToken: initProvider.serviceToken,
      properties: {
        ClusterArn: this.cluster.clusterArn,
        SecretArn: this.cluster.secret!.secretArn,
        DatabaseName: 'acme_crm',
        Version: '1', // Bump to re-run seeding
      },
    });

    // Ensure seeding waits for the DB instance (writer) to be fully available,
    // not just the cluster. Without this, the Lambda fires before the instance
    // is ready and gets DatabaseNotFoundException.
    auroraInit.node.addDependency(this.cluster);

    // Outputs
    new CfnOutput(this, 'ClusterArn', {
      value: this.cluster.clusterArn,
      description: 'Aurora Cluster ARN (for RDS Data API)',
    });

    new CfnOutput(this, 'SecretArn', {
      value: this.cluster.secret!.secretArn,
      description: 'Aurora Credentials Secret ARN',
    });

    new CfnOutput(this, 'DatabaseName', {
      value: 'acme_crm',
      description: 'Default database name',
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions(this.cluster, [
      { id: 'AwsSolutions-RDS14', reason: 'Backtrack is not supported on Aurora Serverless v2' },
      { id: 'AwsSolutions-SMG4', reason: 'Aurora auto-generated secret rotation requires additional setup outside CDK scope' },
      ...(removalPolicy === RemovalPolicy.DESTROY ? [{ id: 'AwsSolutions-RDS10', reason: 'Deletion protection disabled when removalPolicy is DESTROY to allow clean cdk destroy' }] : []),
    ], true);
    NagSuppressions.addResourceSuppressions(initFn, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWSLambdaBasicExecutionRole is required for CloudWatch Logs',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      },
    ], true);
    NagSuppressions.addResourceSuppressions(initProvider, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'CDK Provider framework Lambda requires AWSLambdaBasicExecutionRole',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'CDK Provider framework requires invoke permission on the handler Lambda with :* suffix',
      },
      { id: 'AwsSolutions-L1', reason: 'CDK Provider framework controls the Lambda runtime version' },
    ], true);
  }
}
