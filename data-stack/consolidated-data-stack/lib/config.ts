export const Config = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-west-2',
  },
  prefix: 'acme-data',
  kinesis: {
    streamName: 'acme-telemetry-stream',
    streamMode: 'ON_DEMAND',
    retentionHours: 24,
  },
  s3: {
    dataBucketName: 'acme-telemetry-data',
  },
  lambda: {
    generatorMemory: 256,
    producerMemory: 256,
    timeout: 60,
  },
  glue: {
    databaseName: 'acme_telemetry',
    tableName: 'streaming_events',
    customersTableName: 'customers',
    titlesTableName: 'titles',
    campaignsTableName: 'campaigns',
  },
  firehose: {
    bufferInterval: 60,
    bufferSize: 64, // Minimum 64 MB required for Parquet conversion
  },
};
