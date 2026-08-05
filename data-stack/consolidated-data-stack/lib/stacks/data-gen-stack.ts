import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import { Config } from '../config';
import * as path from 'path';

export interface DataGenStackProps extends cdk.StackProps {
  kinesisStream: kinesis.IStream;
  dataBucket: s3.IBucket;
  glueDatabaseName: string;
  glueTableName: string;
}

export class DataGenStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DataGenStackProps) {
    super(scope, id, props);

    // Producer Lambda - writes to Kinesis (no VPC needed)
    const producerRole = new iam.Role(this, 'ProducerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant Kinesis PutRecords permission
    props.kinesisStream.grantWrite(producerRole);

    const producerFn = new lambda.Function(this, 'ProducerFunction', {
      functionName: `${Config.prefix}-producer`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/producer')),
      timeout: cdk.Duration.seconds(Config.lambda.timeout),
      memorySize: Config.lambda.producerMemory,
      role: producerRole,
      environment: {
        STREAM_NAME: props.kinesisStream.streamName,
      },
    });

    // Generator Lambda
    const generatorRole = new iam.Role(this, 'GeneratorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    generatorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [producerFn.functionArn],
    }));

    const generatorFn = new lambda.Function(this, 'GeneratorFunction', {
      functionName: `${Config.prefix}-generator`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/generator')),
      timeout: cdk.Duration.seconds(60),
      memorySize: Config.lambda.generatorMemory,
      role: generatorRole,
      environment: {
        BATCH_SIZE: '1000',
        PRODUCER_FUNCTION_NAME: producerFn.functionName,
      },
    });

    // EventBridge rule to trigger generator every 5 minutes
    const rule = new events.Rule(this, 'GeneratorSchedule', {
      ruleName: `${Config.prefix}-generator-schedule`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
    });
    rule.addTarget(new targets.LambdaFunction(generatorFn));

    // Firehose IAM role for Kinesis to S3 delivery
    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });

    // Grant Firehose permissions to read from Kinesis
    props.kinesisStream.grantRead(firehoseRole);

    // Grant Firehose permissions to write to S3
    props.dataBucket.grantReadWrite(firehoseRole);

    // Grant Firehose permissions for Glue (required for Parquet conversion)
    firehoseRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'glue:GetTable',
        'glue:GetTableVersion',
        'glue:GetTableVersions',
      ],
      resources: [
        `arn:aws:glue:${this.region}:${this.account}:catalog`,
        `arn:aws:glue:${this.region}:${this.account}:database/${props.glueDatabaseName}`,
        `arn:aws:glue:${this.region}:${this.account}:table/${props.glueDatabaseName}/${props.glueTableName}`,
      ],
    }));

    // CloudWatch log group for Firehose
    const firehoseLogGroup = new logs.LogGroup(this, 'FirehoseLogGroup', {
      logGroupName: `/aws/firehose/${Config.prefix}-kinesis-to-s3`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const firehoseLogStream = new logs.LogStream(this, 'FirehoseLogStream', {
      logGroup: firehoseLogGroup,
      logStreamName: 'delivery',
    });

    // Grant Firehose permissions to write logs
    firehoseLogGroup.grantWrite(firehoseRole);

    // Firehose delivery stream: Kinesis -> S3 (native integration, no VPC needed)
    const deliveryStream = new firehose.CfnDeliveryStream(this, 'KinesisToS3DeliveryStream', {
      deliveryStreamName: `${Config.prefix}-kinesis-to-s3`,
      deliveryStreamType: 'KinesisStreamAsSource',
      // Note: Server-side encryption is not supported for Kinesis-as-source delivery streams (AWS limitation)
      kinesisStreamSourceConfiguration: {
        kinesisStreamArn: props.kinesisStream.streamArn,
        roleArn: firehoseRole.roleArn,
      },
      extendedS3DestinationConfiguration: {
        bucketArn: props.dataBucket.bucketArn,
        roleArn: firehoseRole.roleArn,
        prefix: 'telemetry/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/',
        errorOutputPrefix: 'errors/!{firehose:error-output-type}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
        bufferingHints: {
          intervalInSeconds: Config.firehose.bufferInterval,
          sizeInMBs: Config.firehose.bufferSize,
        },
        compressionFormat: 'UNCOMPRESSED', // Parquet handles compression internally
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: firehoseLogGroup.logGroupName,
          logStreamName: firehoseLogStream.logStreamName,
        },
        // Convert JSON to Parquet using Glue table schema
        dataFormatConversionConfiguration: {
          enabled: true,
          inputFormatConfiguration: {
            deserializer: {
              openXJsonSerDe: {},
            },
          },
          outputFormatConfiguration: {
            serializer: {
              parquetSerDe: {
                compression: 'SNAPPY',
              },
            },
          },
          schemaConfiguration: {
            catalogId: this.account,
            databaseName: props.glueDatabaseName,
            tableName: props.glueTableName,
            region: this.region,
            roleArn: firehoseRole.roleArn,
          },
        },
      },
    });

    // Ensure IAM policy is attached before Firehose is created
    deliveryStream.node.addDependency(firehoseRole);

    // Outputs
    new cdk.CfnOutput(this, 'GeneratorFunctionArn', { value: generatorFn.functionArn });
    new cdk.CfnOutput(this, 'ProducerFunctionArn', { value: producerFn.functionArn });
    new cdk.CfnOutput(this, 'FirehoseDeliveryStreamArn', { value: deliveryStream.attrArn });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions([producerRole, generatorRole], [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWSLambdaBasicExecutionRole is required for CloudWatch Logs access',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      },
    ]);
    NagSuppressions.addResourceSuppressions(firehoseRole, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'CDK grantReadWrite generates wildcard actions scoped to the specific bucket ARN',
        appliesTo: [
          'Action::s3:GetObject*',
          'Action::s3:GetBucket*',
          'Action::s3:List*',
          'Action::s3:DeleteObject*',
          'Action::s3:Abort*',
          `Resource::<DataBucketE3889A50.Arn>/*`,
        ],
      },
    ], true);

    NagSuppressions.addResourceSuppressions([producerFn, generatorFn], [
      { id: 'AwsSolutions-L1', reason: 'Python 3.13 is the latest GA Lambda runtime. CDK defines 3.14 but it is not yet generally available.' },
    ]);

    NagSuppressions.addResourceSuppressions(deliveryStream, [
      { id: 'AwsSolutions-KDF1', reason: 'Firehose server-side encryption is not supported for Kinesis-as-source delivery streams (AWS limitation). Source Kinesis stream is already encrypted.' },
    ]);
  }
}
