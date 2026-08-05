import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import { Config } from '../config';

export class DataLakeStack extends cdk.Stack {
  public readonly dataBucket: s3.Bucket;
  public readonly glueDatabase: glue.CfnDatabase;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 access logs bucket (AwsSolutions-S1)
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `${Config.s3.dataBucketName}-access-logs-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(90) }],
    });

    // S3 bucket for telemetry data
    this.dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `${Config.s3.dataBucketName}-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true, // AwsSolutions-S10
      serverAccessLogsBucket: accessLogsBucket, // AwsSolutions-S1
      serverAccessLogsPrefix: 'data-bucket-logs/',
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          id: 'MoveToIA',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
        {
          id: 'DeleteOldVersions',
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
        {
          id: 'AbortIncompleteUploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // Glue database
    this.glueDatabase = new glue.CfnDatabase(this, 'GlueDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: Config.glue.databaseName,
        description: 'ACME video streaming telemetry data',
      },
    });

    // Glue table for streaming events
    const glueTable = new glue.CfnTable(this, 'StreamingEventsTable', {
      catalogId: this.account,
      databaseName: Config.glue.databaseName,
      tableInput: {
        name: Config.glue.tableName,
        description: 'Video streaming telemetry events',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'classification': 'parquet',
          'parquet.compression': 'SNAPPY',
          // Partition projection: Athena auto-discovers partitions without MSCK REPAIR TABLE or crawlers
          'projection.enabled': 'true',
          'projection.year.type': 'integer',
          'projection.year.range': '2024,2030',
          'projection.month.type': 'integer',
          'projection.month.range': '1,12',
          'projection.month.digits': '2',
          'projection.day.type': 'integer',
          'projection.day.range': '1,31',
          'projection.day.digits': '2',
          'projection.hour.type': 'integer',
          'projection.hour.range': '0,23',
          'projection.hour.digits': '2',
          'storage.location.template': `s3://${this.dataBucket.bucketName}/telemetry/year=\${year}/month=\${month}/day=\${day}/hour=\${hour}/`,
        },
        storageDescriptor: {
          location: `s3://${this.dataBucket.bucketName}/telemetry/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'event_id', type: 'string' },
            { name: 'event_type', type: 'string' },
            { name: 'event_timestamp', type: 'string' },
            { name: 'customer_id', type: 'string' },
            { name: 'title_id', type: 'string' },
            { name: 'session_id', type: 'string' },
            { name: 'device_id', type: 'string' },
            { name: 'title_type', type: 'string' },
            { name: 'device_type', type: 'string' },
            { name: 'device_os', type: 'string' },
            { name: 'app_version', type: 'string' },
            { name: 'quality', type: 'string' },
            { name: 'bandwidth_mbps', type: 'double' },
            { name: 'buffering_events', type: 'int' },
            { name: 'buffering_duration_seconds', type: 'double' },
            { name: 'error_count', type: 'int' },
            { name: 'watch_duration_seconds', type: 'int' },
            { name: 'position_seconds', type: 'int' },
            { name: 'completion_percentage', type: 'double' },
            { name: 'ip_address', type: 'string' },
            { name: 'isp', type: 'string' },
            { name: 'connection_type', type: 'string' },
            { name: 'country', type: 'string' },
            { name: 'state', type: 'string' },
            { name: 'city', type: 'string' },
          ],
        },
        partitionKeys: [
          { name: 'year', type: 'string' },
          { name: 'month', type: 'string' },
          { name: 'day', type: 'string' },
          { name: 'hour', type: 'string' },
        ],
      },
    });
    glueTable.addDependency(this.glueDatabase);

    // Glue table for customers
    const customersTable = new glue.CfnTable(this, 'CustomersTable', {
      catalogId: this.account,
      databaseName: Config.glue.databaseName,
      tableInput: {
        name: Config.glue.customersTableName,
        description: 'Customer data for ACME video streaming platform',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'classification': 'parquet',
          'parquet.compression': 'SNAPPY',
        },
        storageDescriptor: {
          location: `s3://${this.dataBucket.bucketName}/customers/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'customer_id', type: 'string' },
            { name: 'email', type: 'string' },
            { name: 'first_name', type: 'string' },
            { name: 'last_name', type: 'string' },
            { name: 'date_of_birth', type: 'string' },
            { name: 'age_group', type: 'string' },
            { name: 'subscription_tier', type: 'string' },
            { name: 'subscription_start_date', type: 'string' },
            { name: 'subscription_end_date', type: 'string' },
            { name: 'country', type: 'string' },
            { name: 'state', type: 'string' },
            { name: 'city', type: 'string' },
            { name: 'timezone', type: 'string' },
            { name: 'payment_method', type: 'string' },
            { name: 'monthly_revenue', type: 'double' },
            { name: 'lifetime_value', type: 'double' },
            { name: 'is_active', type: 'boolean' },
            { name: 'acquisition_channel', type: 'string' },
            { name: 'preferred_genres', type: 'string' },
            { name: 'created_at', type: 'string' },
            { name: 'updated_at', type: 'string' },
          ],
        },
      },
    });
    customersTable.addDependency(this.glueDatabase);

    // Glue table for titles
    const titlesTable = new glue.CfnTable(this, 'TitlesTable', {
      catalogId: this.account,
      databaseName: Config.glue.databaseName,
      tableInput: {
        name: Config.glue.titlesTableName,
        description: 'Title catalog for ACME video streaming platform',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'classification': 'parquet',
          'parquet.compression': 'SNAPPY',
        },
        storageDescriptor: {
          location: `s3://${this.dataBucket.bucketName}/titles/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'title_id', type: 'string' },
            { name: 'title_name', type: 'string' },
            { name: 'title_type', type: 'string' },
            { name: 'genre', type: 'string' },
            { name: 'sub_genre', type: 'string' },
            { name: 'content_rating', type: 'string' },
            { name: 'release_date', type: 'string' },
            { name: 'duration_minutes', type: 'int' },
            { name: 'season_number', type: 'double' },
            { name: 'episode_number', type: 'double' },
            { name: 'production_country', type: 'string' },
            { name: 'original_language', type: 'string' },
            { name: 'available_languages', type: 'string' },
            { name: 'director', type: 'string' },
            { name: 'cast', type: 'string' },
            { name: 'production_studio', type: 'string' },
            { name: 'popularity_score', type: 'double' },
            { name: 'critical_rating', type: 'double' },
            { name: 'viewer_rating', type: 'double' },
            { name: 'budget_millions', type: 'double' },
            { name: 'revenue_millions', type: 'double' },
            { name: 'awards_count', type: 'int' },
            { name: 'is_original', type: 'boolean' },
            { name: 'licensing_cost', type: 'double' },
            { name: 'created_at', type: 'string' },
            { name: 'updated_at', type: 'string' },
          ],
        },
      },
    });
    titlesTable.addDependency(this.glueDatabase);

    // Glue table for campaigns
    const campaignsTable = new glue.CfnTable(this, 'CampaignsTable', {
      catalogId: this.account,
      databaseName: Config.glue.databaseName,
      tableInput: {
        name: Config.glue.campaignsTableName,
        description: 'Ad campaign data for ACME video streaming platform',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'classification': 'parquet',
          'parquet.compression': 'SNAPPY',
        },
        storageDescriptor: {
          location: `s3://${this.dataBucket.bucketName}/campaigns/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'campaign_id', type: 'string' },
            { name: 'campaign_name', type: 'string' },
            { name: 'advertiser_id', type: 'string' },
            { name: 'advertiser_name', type: 'string' },
            { name: 'industry', type: 'string' },
            { name: 'campaign_type', type: 'string' },
            { name: 'objective', type: 'string' },
            { name: 'start_date', type: 'string' },
            { name: 'end_date', type: 'string' },
            { name: 'status', type: 'string' },
            { name: 'daily_budget', type: 'double' },
            { name: 'total_budget', type: 'double' },
            { name: 'spent_amount', type: 'double' },
            { name: 'target_age_groups', type: 'string' },
            { name: 'target_genders', type: 'string' },
            { name: 'target_countries', type: 'string' },
            { name: 'target_genres', type: 'string' },
            { name: 'target_subscription_tiers', type: 'string' },
            { name: 'ad_format', type: 'string' },
            { name: 'ad_duration_seconds', type: 'int' },
            { name: 'placement_type', type: 'string' },
            { name: 'creative_url', type: 'string' },
            { name: 'landing_page_url', type: 'string' },
            { name: 'impressions', type: 'bigint' },
            { name: 'unique_viewers', type: 'bigint' },
            { name: 'clicks', type: 'bigint' },
            { name: 'conversions', type: 'bigint' },
            { name: 'view_through_rate', type: 'double' },
            { name: 'click_through_rate', type: 'double' },
            { name: 'conversion_rate', type: 'double' },
            { name: 'cost_per_mille', type: 'double' },
            { name: 'cost_per_click', type: 'double' },
            { name: 'cost_per_conversion', type: 'double' },
            { name: 'created_at', type: 'string' },
            { name: 'updated_at', type: 'string' },
          ],
        },
      },
    });
    campaignsTable.addDependency(this.glueDatabase);

    // IAM role for Athena/Glue access
    const dataAccessRole = new iam.Role(this, 'DataAccessRole', {
      roleName: `${Config.prefix}-data-access-role`,
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('glue.amazonaws.com'),
        new iam.ServicePrincipal('athena.amazonaws.com')
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });

    this.dataBucket.grantReadWrite(dataAccessRole);

    // cdk-nag suppressions for CDK-generated wildcard permissions
    NagSuppressions.addResourceSuppressions(dataAccessRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWSGlueServiceRole is required for Glue crawlers and ETL jobs to function',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSGlueServiceRole'],
      },
    ]);
    NagSuppressions.addResourceSuppressions(dataAccessRole, [
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

    NagSuppressions.addResourceSuppressions(accessLogsBucket, [
      { id: 'AwsSolutions-S1', reason: 'This is the access logs bucket itself — no recursive logging needed' },
    ]);

    // Outputs
    new cdk.CfnOutput(this, 'DataBucketName', { value: this.dataBucket.bucketName });
    new cdk.CfnOutput(this, 'GlueDatabaseName', { value: Config.glue.databaseName });
  }
}
