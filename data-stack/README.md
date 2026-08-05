# Data Stack

Serverless streaming data infrastructure for generating, processing, and analyzing ACME Corp telemetry data.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  DATA GENERATION                                                     │
│  EventBridge (5 min) → Generator Lambda → Producer Lambda            │
│                                                │                     │
│                                                ▼                     │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐         │
│  │   Athena     │◀────│ Glue Catalog │◀────│   Kinesis    │         │
│  │  (Queries)   │     │              │     │   Stream     │         │
│  └──────┬───────┘     └──────────────┘     └──────┬───────┘         │
│         │                                         │                  │
│         │              ┌──────────────┐           │                  │
│         └─────────────▶│  S3 Data     │◀──────────┘                  │
│                        │  Lake        │   (via Firehose)             │
│                        └──────────────┘                              │
└─────────────────────────────────────────────────────────────────────┘
```

## Stacks

| Stack | Resources |
|-------|-----------|
| `AcmeKinesisStack` | Kinesis Data Stream (On-Demand mode, 24hr retention) |
| `AcmeDataLakeStack` | S3 bucket, Glue database and tables (4 tables) |
| `AcmeDataGenStack` | Generator/Producer Lambdas (`acme-data-generator`, `acme-data-producer`), Firehose delivery stream (`acme-data-kinesis-to-s3`), EventBridge schedule |

## Components

| Component | Description |
|-----------|-------------|
| **Kinesis Data Stream** | On-Demand mode, auto-scales, 24hr retention |
| **Kinesis Firehose** | Delivers to S3 with Hive partitioning (year/month/day/hour); 64 MB / 60 s buffer |
| **Lambda Functions** | Generator creates 1000 synthetic events per batch (every 5 min) |
| **S3 Data Lake** | Parquet with SNAPPY compression, Hive partitioned |
| **Glue Catalog** | Table definitions for Athena queries; partition projection on `streaming_events` |

## Deployment

> **For deployment instructions, see the [main README](../README.md) in the repository root.**
>
> The main README contains the complete step-by-step deployment guide with verification checks.

## Stack Outputs

| Stack | Output | Description |
|-------|--------|-------------|
| `AcmeKinesisStack` | `StreamArn` | Kinesis Data Stream ARN |
| `AcmeKinesisStack` | `StreamName` | Kinesis stream name (`acme-telemetry-stream`) |
| `AcmeDataLakeStack` | `DataBucketName` | S3 bucket for telemetry data |
| `AcmeDataLakeStack` | `GlueDatabaseName` | Athena database name (`acme_telemetry`) |
| `AcmeDataGenStack` | `FirehoseDeliveryStreamArn` | Firehose delivery stream ARN |
| `AcmeDataGenStack` | `GeneratorFunctionArn` | Generator Lambda ARN |
| `AcmeDataGenStack` | `ProducerFunctionArn` | Producer Lambda ARN |

## Configuration

All configuration in `consolidated-data-stack/lib/config.ts`:

```typescript
Config.env.region              // AWS region (us-west-2)
Config.prefix                  // Resource name prefix (acme-data)
Config.kinesis.streamName      // Kinesis stream name (acme-telemetry-stream)
Config.kinesis.streamMode      // ON_DEMAND (auto-scales)
Config.kinesis.retentionHours  // Stream retention (24)
Config.s3.dataBucketName       // Bucket name prefix (acme-telemetry-data)
Config.glue.databaseName       // Athena database name (acme_telemetry)
Config.glue.tableName          // Streaming table name (streaming_events)
Config.lambda.timeout          // Lambda timeout (60s)
Config.firehose.bufferSize     // Firehose buffer in MB (64 — minimum for Parquet)
Config.firehose.bufferInterval // Firehose buffer interval in seconds (60)
```

The S3 bucket name is `${Config.s3.dataBucketName}-${ACCOUNT}-${REGION}`, e.g.
`acme-telemetry-data-123456789012-us-west-2`.

## Data Schema

**Database**: `acme_telemetry`

| Table | Description | Partitioned | Records |
|-------|-------------|-------------|---------|
| `streaming_events` | Telemetry events (25 columns) | Yes (year/month/day/hour, partition projection) | Streaming + batch |
| `customers` | Customer profiles (21 columns) | No | 1,000 |
| `titles` | Video catalog (26 columns) | No | 500 |
| `campaigns` | Ad campaigns (35 columns) | No | 50 |

### streaming_events (Key Columns)

| Column | Type | Values |
|--------|------|--------|
| event_id | STRING | Unique event identifier |
| event_timestamp | STRING | ISO 8601 timestamp |
| event_type | STRING | start, pause, resume, stop, complete |
| customer_id | STRING | Customer identifier |
| title_id | STRING | Content identifier |
| title_type | STRING | movie, series, documentary |
| device_type | STRING | mobile, web, tv, tablet |
| quality | STRING | SD, HD, 4K |
| bandwidth_mbps | DOUBLE | Stream bandwidth |
| buffering_events | INT | Buffering event count |
| error_count | INT | Error count |
| watch_duration_seconds | INT | Watch duration |
| completion_percentage | DOUBLE | Completion percentage |
| country / state / city | STRING | Geographic location |

### customers (Key Columns)

| Column | Type | Description |
|--------|------|-------------|
| customer_id | STRING | Unique customer ID (links to `streaming_events`) |
| subscription_tier | STRING | free_with_ads, basic, standard, premium |
| country | STRING | Customer country |
| is_active | BOOLEAN | Active subscription |
| lifetime_value | DOUBLE | Customer LTV |

### titles (Key Columns)

| Column | Type | Description |
|--------|------|-------------|
| title_id | STRING | Unique title ID |
| title_name | STRING | Title name |
| title_type | STRING | movie, series, documentary |
| genre | STRING | Content genre |
| popularity_score | DOUBLE | Popularity (0-100) |
| viewer_rating | DOUBLE | Viewer rating |

### campaigns (Key Columns)

| Column | Type | Description |
|--------|------|-------------|
| campaign_id | STRING | Unique campaign ID |
| campaign_name | STRING | Campaign name |
| advertiser_name | STRING | Advertiser name |
| campaign_type | STRING | brand_awareness, conversion, retention |
| impressions | BIGINT | Total impressions |
| click_through_rate | DOUBLE | CTR |
| conversion_rate | DOUBLE | Conversion rate |
| conversions | BIGINT | Total conversions |

## Query Examples

### Basic Analytics
```sql
-- Total events
SELECT COUNT(*) as total_events FROM acme_telemetry.streaming_events;

-- Events by type
SELECT event_type, COUNT(*) as count
FROM acme_telemetry.streaming_events
GROUP BY event_type ORDER BY count DESC;

-- Device type distribution
SELECT device_type, COUNT(*) as events,
       AVG(watch_duration_seconds) as avg_watch_duration
FROM acme_telemetry.streaming_events
GROUP BY device_type ORDER BY events DESC;
```

### Quality & Performance
```sql
-- Quality distribution with buffering stats
SELECT quality, COUNT(*) as events,
       AVG(buffering_events) as avg_buffering,
       AVG(bandwidth_mbps) as avg_bandwidth
FROM acme_telemetry.streaming_events
GROUP BY quality ORDER BY events DESC;

-- Error rates by device
SELECT device_type,
       SUM(error_count) as total_errors,
       AVG(error_count) as avg_errors_per_session
FROM acme_telemetry.streaming_events
GROUP BY device_type;
```

### Geographic Analysis
```sql
-- Events by country
SELECT country, COUNT(*) as events
FROM acme_telemetry.streaming_events
GROUP BY country ORDER BY events DESC LIMIT 10;

-- ISP performance
SELECT isp, AVG(bandwidth_mbps) as avg_bandwidth,
       AVG(buffering_events) as avg_buffering
FROM acme_telemetry.streaming_events
GROUP BY isp ORDER BY avg_bandwidth DESC;
```

### Time-Based Analysis
```sql
-- Hourly event distribution
SELECT hour, COUNT(*) as events,
       AVG(completion_percentage) as avg_completion
FROM acme_telemetry.streaming_events
GROUP BY hour ORDER BY hour;

-- Efficient single-partition query
SELECT event_type, COUNT(*) as count
FROM acme_telemetry.streaming_events
WHERE year='2026' AND month='01' AND day='15'
GROUP BY event_type;
```

### Customer & Content Analytics
```sql
-- Customers by subscription tier
SELECT subscription_tier, COUNT(*) as customers,
       AVG(lifetime_value) as avg_ltv
FROM acme_telemetry.customers
GROUP BY subscription_tier ORDER BY customers DESC;

-- Top rated content
SELECT title_name, genre, viewer_rating, popularity_score
FROM acme_telemetry.titles
ORDER BY viewer_rating DESC LIMIT 10;

-- Campaign performance by type
SELECT campaign_type, COUNT(*) as campaigns,
       SUM(impressions) as total_impressions,
       AVG(click_through_rate) as avg_ctr
FROM acme_telemetry.campaigns
GROUP BY campaign_type;
```

## Logs

```bash
# Generator Lambda
aws logs tail /aws/lambda/acme-data-generator --region us-west-2 --since 10m

# Producer Lambda
aws logs tail /aws/lambda/acme-data-producer --region us-west-2 --since 10m
```

## Manual Testing

```bash
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# Invoke generator manually
aws lambda invoke --function-name acme-data-generator --region us-west-2 /dev/stdout

# Check Kinesis stream
aws kinesis describe-stream-summary --stream-name acme-telemetry-stream --region us-west-2

# Check S3 data
aws s3 ls s3://acme-telemetry-data-${ACCOUNT}-us-west-2/telemetry/ --recursive | tail -10

# NOTE: Partition projection is enabled on streaming_events — no MSCK REPAIR needed
```

## Troubleshooting

### Quick Diagnostic Commands

```bash
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# Check all stack statuses
for stack in AcmeKinesisStack AcmeDataLakeStack AcmeDataGenStack; do
  echo -n "$stack: "
  aws cloudformation describe-stacks --stack-name $stack \
    --query 'Stacks[0].StackStatus' --output text --region us-west-2 2>/dev/null || echo "NOT DEPLOYED"
done

# Check Glue database and tables
aws glue get-database --name acme_telemetry --region us-west-2 \
  --query 'Database.Name' --output text && echo "✓ Glue database exists"
aws glue get-tables --database-name acme_telemetry --region us-west-2 \
  --query 'TableList[*].Name' --output text

# Check S3 bucket has data
aws s3 ls s3://acme-telemetry-data-${ACCOUNT}-us-west-2/ --region us-west-2
```

### Common Issues

| Issue | Solution |
|-------|----------|
| `CDK bootstrap required` | Run `cdk bootstrap aws://ACCOUNT/us-west-2` |
| `Unable to locate credentials` | Run `aws configure` or check IAM permissions |
| `Resource already exists` | Stack partially deployed — run `cdk destroy --all` then redeploy |
| No data in Athena queries | Check S3 has data; verify Hive partition format (`year=/month=/day=/hour=`) |

### Athena HIVE_CURSOR_ERROR

Schema mismatch between Parquet files and Glue table. Recreate the table:

```sql
DROP TABLE IF EXISTS acme_telemetry.streaming_events;

CREATE EXTERNAL TABLE acme_telemetry.streaming_events (
  event_id STRING, event_type STRING, event_timestamp STRING,
  customer_id STRING, title_id STRING, session_id STRING,
  device_id STRING, title_type STRING, device_type STRING,
  device_os STRING, app_version STRING, quality STRING,
  bandwidth_mbps DOUBLE, buffering_events INT,
  buffering_duration_seconds DOUBLE, error_count INT,
  watch_duration_seconds INT, position_seconds INT,
  completion_percentage DOUBLE, ip_address STRING,
  isp STRING, connection_type STRING, country STRING,
  state STRING, city STRING
)
PARTITIONED BY (year STRING, month STRING, day STRING, hour STRING)
STORED AS PARQUET
LOCATION 's3://acme-telemetry-data-<ACCOUNT>-us-west-2/telemetry/'
TBLPROPERTIES (
  'parquet.compression'='SNAPPY',
  'projection.enabled'='true',
  'projection.year.type'='integer', 'projection.year.range'='2024,2030',
  'projection.month.type'='integer', 'projection.month.range'='1,12', 'projection.month.digits'='2',
  'projection.day.type'='integer', 'projection.day.range'='1,31', 'projection.day.digits'='2',
  'projection.hour.type'='integer', 'projection.hour.range'='0,23', 'projection.hour.digits'='2',
  'storage.location.template'='s3://acme-telemetry-data-<ACCOUNT>-us-west-2/telemetry/year=${year}/month=${month}/day=${day}/hour=${hour}/'
);
-- No MSCK REPAIR needed — partition projection auto-discovers partitions
```

> The `projection.year.range` of `2024,2030` means the first query after deploy scans
> roughly 62K virtual partitions and can take ~3.5 minutes. Narrow the range if you only
> need recent data. Subsequent queries are fast.

## Security

See [CONTRIBUTING](../CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the [LICENSE](../LICENSE) file.
