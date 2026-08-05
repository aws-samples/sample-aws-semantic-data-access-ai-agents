import * as cdk from 'aws-cdk-lib';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import { Construct } from 'constructs';
import { Config } from '../config';

export class KinesisStack extends cdk.Stack {
  public readonly stream: kinesis.Stream;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Kinesis Data Stream with On-Demand capacity mode (auto-scales, no shard management)
    this.stream = new kinesis.Stream(this, 'TelemetryStream', {
      streamName: Config.kinesis.streamName,
      streamMode: kinesis.StreamMode.ON_DEMAND,
      retentionPeriod: cdk.Duration.hours(Config.kinesis.retentionHours),
      encryption: kinesis.StreamEncryption.MANAGED,
    });

    // Outputs
    new cdk.CfnOutput(this, 'StreamArn', { value: this.stream.streamArn });
    new cdk.CfnOutput(this, 'StreamName', { value: this.stream.streamName });
  }
}
