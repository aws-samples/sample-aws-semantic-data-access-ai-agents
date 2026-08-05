#!/bin/bash
# Setup script for ACME Data Lake
# Generates synthetic data and uploads to S3

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_GEN_DIR="$PROJECT_DIR/data_generation"
OUTPUT_DIR="$PROJECT_DIR/output"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}ACME Data Lake Setup${NC}"
echo "===================="

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &>/dev/null; then
    echo -e "${RED}Error: AWS CLI not configured. Please run 'aws configure' first.${NC}"
    exit 1
fi

# Get AWS account and region
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-west-2}
BUCKET_NAME="acme-telemetry-data-${AWS_ACCOUNT}-${AWS_REGION}"

echo "AWS Account: $AWS_ACCOUNT"
echo "AWS Region: $AWS_REGION"
echo "S3 Bucket: $BUCKET_NAME"

# Check if bucket exists
if ! aws s3 ls "s3://$BUCKET_NAME" &>/dev/null; then
    echo -e "${RED}Error: S3 bucket $BUCKET_NAME does not exist.${NC}"
    echo "Please deploy the CDK stack first: npx cdk deploy --all"
    exit 1
fi

# Create Python virtual environment if it doesn't exist
if [ ! -d "$PROJECT_DIR/venv" ]; then
    echo -e "\n${YELLOW}Creating Python virtual environment...${NC}"
    python3 -m venv "$PROJECT_DIR/venv"
fi

# Activate virtual environment
source "$PROJECT_DIR/venv/bin/activate"

# Install dependencies
echo -e "\n${YELLOW}Installing Python dependencies...${NC}"
pip install --quiet --upgrade pip
pip install --quiet pandas numpy faker pyarrow tqdm click boto3

# Generate data
echo -e "\n${YELLOW}Generating synthetic data...${NC}"
cd "$DATA_GEN_DIR"
python main.py --output-dir "$OUTPUT_DIR" --num-customers 10000 --num-titles 1000 --num-events 100000 --num-campaigns 50

# Upload to S3
echo -e "\n${YELLOW}Uploading data to S3...${NC}"
aws s3 sync "$OUTPUT_DIR" "s3://$BUCKET_NAME/raw/" --exclude "*.DS_Store"

# Create/update Glue tables
echo -e "\n${YELLOW}Creating Glue tables...${NC}"

# Function to create table if not exists
create_table_if_not_exists() {
    local table_name=$1
    local table_input=$2

    if aws glue get-table --database-name acme_telemetry --name "$table_name" --region "$AWS_REGION" &>/dev/null; then
        echo "Table $table_name already exists, skipping..."
    else
        aws glue create-table --database-name acme_telemetry --region "$AWS_REGION" --table-input "$table_input"
        echo "Created table $table_name"
    fi
}

# Create customers table
create_table_if_not_exists "customers" '{
  "Name": "customers",
  "StorageDescriptor": {
    "Columns": [
      {"Name": "customer_id", "Type": "string"},
      {"Name": "email", "Type": "string"},
      {"Name": "first_name", "Type": "string"},
      {"Name": "last_name", "Type": "string"},
      {"Name": "date_of_birth", "Type": "date"},
      {"Name": "age_group", "Type": "string"},
      {"Name": "subscription_tier", "Type": "string"},
      {"Name": "subscription_start_date", "Type": "timestamp"},
      {"Name": "subscription_end_date", "Type": "timestamp"},
      {"Name": "country", "Type": "string"},
      {"Name": "state", "Type": "string"},
      {"Name": "city", "Type": "string"},
      {"Name": "timezone", "Type": "string"},
      {"Name": "payment_method", "Type": "string"},
      {"Name": "monthly_revenue", "Type": "double"},
      {"Name": "lifetime_value", "Type": "double"},
      {"Name": "is_active", "Type": "boolean"},
      {"Name": "acquisition_channel", "Type": "string"},
      {"Name": "preferred_genres", "Type": "array<string>"},
      {"Name": "created_at", "Type": "timestamp"},
      {"Name": "updated_at", "Type": "timestamp"}
    ],
    "Location": "s3://'"$BUCKET_NAME"'/raw/customers/",
    "InputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
    "OutputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
    "SerdeInfo": {"SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"}
  },
  "TableType": "EXTERNAL_TABLE"
}'

# Create titles table
create_table_if_not_exists "titles" '{
  "Name": "titles",
  "StorageDescriptor": {
    "Columns": [
      {"Name": "title_id", "Type": "string"},
      {"Name": "title_name", "Type": "string"},
      {"Name": "title_type", "Type": "string"},
      {"Name": "genre", "Type": "string"},
      {"Name": "sub_genre", "Type": "string"},
      {"Name": "content_rating", "Type": "string"},
      {"Name": "release_date", "Type": "date"},
      {"Name": "duration_minutes", "Type": "int"},
      {"Name": "season_number", "Type": "int"},
      {"Name": "episode_number", "Type": "int"},
      {"Name": "production_country", "Type": "string"},
      {"Name": "original_language", "Type": "string"},
      {"Name": "available_languages", "Type": "array<string>"},
      {"Name": "director", "Type": "string"},
      {"Name": "cast_members", "Type": "array<string>"},
      {"Name": "production_studio", "Type": "string"},
      {"Name": "popularity_score", "Type": "double"},
      {"Name": "critical_rating", "Type": "double"},
      {"Name": "viewer_rating", "Type": "double"},
      {"Name": "budget_millions", "Type": "double"},
      {"Name": "revenue_millions", "Type": "double"},
      {"Name": "awards_count", "Type": "int"},
      {"Name": "is_original", "Type": "boolean"},
      {"Name": "licensing_cost", "Type": "double"},
      {"Name": "created_at", "Type": "timestamp"},
      {"Name": "updated_at", "Type": "timestamp"}
    ],
    "Location": "s3://'"$BUCKET_NAME"'/raw/titles/",
    "InputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
    "OutputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
    "SerdeInfo": {"SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"}
  },
  "TableType": "EXTERNAL_TABLE"
}'

# Create telemetry table (partitioned)
create_table_if_not_exists "telemetry" '{
  "Name": "telemetry",
  "StorageDescriptor": {
    "Columns": [
      {"Name": "event_id", "Type": "string"},
      {"Name": "customer_id", "Type": "string"},
      {"Name": "title_id", "Type": "string"},
      {"Name": "session_id", "Type": "string"},
      {"Name": "event_type", "Type": "string"},
      {"Name": "event_timestamp", "Type": "timestamp"},
      {"Name": "watch_duration_seconds", "Type": "int"},
      {"Name": "position_seconds", "Type": "int"},
      {"Name": "completion_percentage", "Type": "double"},
      {"Name": "device_type", "Type": "string"},
      {"Name": "device_id", "Type": "string"},
      {"Name": "device_os", "Type": "string"},
      {"Name": "app_version", "Type": "string"},
      {"Name": "quality", "Type": "string"},
      {"Name": "bandwidth_mbps", "Type": "double"},
      {"Name": "buffering_events", "Type": "int"},
      {"Name": "buffering_duration_seconds", "Type": "int"},
      {"Name": "error_count", "Type": "int"},
      {"Name": "ip_address", "Type": "string"},
      {"Name": "country", "Type": "string"},
      {"Name": "state", "Type": "string"},
      {"Name": "city", "Type": "string"},
      {"Name": "isp", "Type": "string"},
      {"Name": "connection_type", "Type": "string"}
    ],
    "Location": "s3://'"$BUCKET_NAME"'/raw/telemetry/",
    "InputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
    "OutputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
    "SerdeInfo": {"SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"}
  },
  "PartitionKeys": [{"Name": "date", "Type": "string"}],
  "TableType": "EXTERNAL_TABLE"
}'

# Create campaigns table
create_table_if_not_exists "campaigns" '{
  "Name": "campaigns",
  "StorageDescriptor": {
    "Columns": [
      {"Name": "campaign_id", "Type": "string"},
      {"Name": "campaign_name", "Type": "string"},
      {"Name": "advertiser_id", "Type": "string"},
      {"Name": "advertiser_name", "Type": "string"},
      {"Name": "industry", "Type": "string"},
      {"Name": "campaign_type", "Type": "string"},
      {"Name": "objective", "Type": "string"},
      {"Name": "start_date", "Type": "date"},
      {"Name": "end_date", "Type": "date"},
      {"Name": "status", "Type": "string"},
      {"Name": "daily_budget", "Type": "double"},
      {"Name": "total_budget", "Type": "double"},
      {"Name": "spent_amount", "Type": "double"},
      {"Name": "target_age_groups", "Type": "array<string>"},
      {"Name": "target_genders", "Type": "array<string>"},
      {"Name": "target_countries", "Type": "array<string>"},
      {"Name": "target_genres", "Type": "array<string>"},
      {"Name": "target_subscription_tiers", "Type": "array<string>"},
      {"Name": "ad_format", "Type": "string"},
      {"Name": "ad_duration_seconds", "Type": "int"},
      {"Name": "placement_type", "Type": "string"},
      {"Name": "creative_url", "Type": "string"},
      {"Name": "landing_page_url", "Type": "string"},
      {"Name": "impressions", "Type": "bigint"},
      {"Name": "unique_viewers", "Type": "bigint"},
      {"Name": "clicks", "Type": "bigint"},
      {"Name": "conversions", "Type": "bigint"},
      {"Name": "view_through_rate", "Type": "double"},
      {"Name": "click_through_rate", "Type": "double"},
      {"Name": "conversion_rate", "Type": "double"},
      {"Name": "cost_per_mille", "Type": "double"},
      {"Name": "cost_per_click", "Type": "double"},
      {"Name": "cost_per_conversion", "Type": "double"},
      {"Name": "created_at", "Type": "timestamp"},
      {"Name": "updated_at", "Type": "timestamp"}
    ],
    "Location": "s3://'"$BUCKET_NAME"'/raw/campaigns/",
    "InputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
    "OutputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
    "SerdeInfo": {"SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"}
  },
  "TableType": "EXTERNAL_TABLE"
}'

# Repair telemetry partitions
echo -e "\n${YELLOW}Repairing telemetry table partitions...${NC}"
QUERY_ID=$(aws athena start-query-execution \
  --query-string "MSCK REPAIR TABLE telemetry" \
  --query-execution-context Database=acme_telemetry \
  --work-group primary \
  --region "$AWS_REGION" \
  --result-configuration OutputLocation="s3://$BUCKET_NAME/athena-results/" \
  --query 'QueryExecutionId' --output text)

echo "Waiting for partition repair to complete..."
aws athena wait query-execution-completed --query-execution-id "$QUERY_ID" --region "$AWS_REGION" 2>/dev/null || sleep 10

echo -e "\n${GREEN}Setup Complete!${NC}"
echo ""
echo "Data Lake Summary:"
echo "  - S3 Bucket: s3://$BUCKET_NAME/raw/"
echo "  - Glue Database: acme_telemetry"
echo "  - Tables: customers, titles, telemetry, campaigns"
echo ""
echo "Query data using Athena:"
echo "  aws athena start-query-execution \\"
echo "    --query-string \"SELECT * FROM customers LIMIT 10\" \\"
echo "    --query-execution-context Database=acme_telemetry \\"
echo "    --work-group primary --region $AWS_REGION \\"
echo "    --result-configuration OutputLocation=s3://$BUCKET_NAME/athena-results/"
