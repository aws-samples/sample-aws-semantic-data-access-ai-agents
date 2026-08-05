# Semantic Data Access for AI Agents on AWS

This repository demonstrates AWS Bedrock AgentCore with MCP (Model Context Protocol) integration for building intelligent agents that can interact with real-time streaming data.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                     USER                                              │
│                                       │                                               │
│                                       ▼                                               │
│  ┌──────────────────────────────────────────────────────────────────────────────┐    │
│  │                          AGENT STACK (agent-stack/)                           │    │
│  │                                                                               │    │
│  │   ┌──────────────┐      ┌─────────────┐      ┌────────────────────────┐      │    │
│  │   │  CloudFront  │      │   Cognito   │      │  Bedrock AgentCore     │      │    │
│  │   │  + S3        │      │  User Pool  │      │  ┌──────────────────┐  │      │    │
│  │   │  (React App) │─────▶│  (Auth)     │─────▶│  │  Main Agent      │  │      │    │
│  │   └──────────────┘      └─────────────┘      │  │  (Claude Haiku)  │  │      │    │
│  │                                              │  │  + Memory        │  │      │    │
│  │                                              │  │  + Code Interp.  │  │      │    │
│  │                                              │  └────────┬─────────┘  │      │    │
│  │                                              └───────────┼────────────┘      │    │
│  │                                                          │                   │    │
│  │                                              ┌───────────▼────────────┐      │    │
│  │                                              │    AgentCore           │      │    │
│  │                                              │    MCP Gateway         │      │    │
│  │                                              │    (OAuth + Semantic)  │      │    │
│  │                                              └───────────┬────────────┘      │    │
│  │                                                          │                   │    │
│  │                    ┌─────────────────────────────────────┼──────────────┐    │    │
│  │                    │      MCP Servers (Cognito OAuth)    │              │    │    │
│  │                    │  ┌───────────┐ ┌──────────────┐ ┌──▼──────────┐   │    │    │
│  │                    │  │ AWS Docs  │ │Data Processing│ │ MySQL MCP   │   │    │    │
│  │                    │  │ MCP Server│ │ MCP Server   │ │ (Aurora CRM)│   │    │    │
│  │                    │  └───────────┘ └──────┬───────┘ └─────────────┘   │    │    │
│  │                    └───────────────────────┼───────────────────────────┘    │    │
│  │                                            │                               │    │
│  │   ┌──────────────────┐                     │                               │    │
│  │   │  Aurora MySQL     │◀───────────────────┘ (via RDS Data API)            │    │
│  │   │  Serverless v2    │                                                     │    │
│  │   │  (CRM Database)   │                                                     │    │
│  │   └──────────────────┘                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────┘    │
│                                            │                                        │
│                                   Athena Queries                                    │
│                                            │                                        │
│  ┌─────────────────────────────────────────▼───────────────────────────────────┐    │
│  │                          DATA STACK (data-stack/)                            │    │
│  │                                                                              │    │
│  │   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │    │
│  │   │ EventBridge  │────▶│  Generator   │────▶│  Producer    │                │    │
│  │   │ (5 min)      │     │  Lambda      │     │  Lambda      │                │    │
│  │   └──────────────┘     └──────────────┘     └──────┬───────┘                │    │
│  │                                                    │                        │    │
│  │                                                    ▼                        │    │
│  │   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │    │
│  │   │   Athena     │◀────│ Glue Catalog │◀────│   Kinesis    │                │    │
│  │   │  (Queries)   │     │ (Partition   │     │   Firehose   │                │    │
│  │   └──────┬───────┘     │  Projection) │     └──────┬───────┘                │    │
│  │          │              └──────────────┘           │                        │    │
│  │          │              ┌──────────────┐           │                        │    │
│  │          └─────────────▶│  S3 Data     │◀──────────┘                        │    │
│  │                         │  Lake        │                                    │    │
│  │                         └──────────────┘                                    │    │
│  └─────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User Interaction**: User accesses the React app via CloudFront, authenticates with Cognito
2. **Agent Invocation**: Authenticated requests invoke the Bedrock AgentCore Runtime
3. **MCP Gateway**: Agent discovers and calls tools via the MCP Gateway (OAuth auth, semantic search)
4. **MCP Tools**: 3 MCP servers provide AWS docs search, Athena analytics, and CRM queries
5. **CRM Queries**: MySQL MCP server queries Aurora MySQL Serverless v2 (CRM data) via RDS Data API
6. **Data Queries**: Data Processing MCP server runs Athena SQL queries on the S3 data lake
7. **Data Generation**: EventBridge triggers Lambda every 5 minutes to generate synthetic telemetry
8. **Data Pipeline**: Kinesis Firehose delivers streaming data to S3 with Hive partitioning
9. **Partition Projection**: Athena auto-discovers new partitions without crawlers or manual repair

## Stack Overview

The project is organized into two main stacks:

### Agent Stack (`agent-stack/`)
Contains the AI agent infrastructure built with AWS Bedrock AgentCore:

- **Frontend**: React TypeScript application with AWS Cognito authentication
- **Backend**: Python Strands agent powered by Claude Haiku 4.5
- **Memory**: AWS Bedrock AgentCore Memory for conversation persistence
- **MCP Integration**: 3 MCP servers (AWS Docs, Data Processing, MySQL CRM)
- **MCP Gateway**: AgentCore Gateway for unified tool access (OAuth auth, semantic search)
- **Aurora MySQL**: Serverless v2 database for CRM data (support tickets, content ratings)
- **Code Interpreter**: Python execution for data visualization

### Data Stack (`data-stack/`)
Contains the streaming data infrastructure and analytics:

- **Kinesis Data Stream**: On-Demand mode real-time data streaming
- **Kinesis Firehose**: Delivers data to S3 with Hive partitioning (Parquet + SNAPPY)
- **Data Generation**: Lambda functions generating synthetic ACME Corp telemetry data
- **Data Lake**: S3-based storage with Glue catalog and Athena partition projection

## AWS Services Used

- **AWS Bedrock AgentCore**: Agent runtime, memory, and MCP server hosting
- **AWS Bedrock AgentCore Gateway**: Unified MCP tool access (OAuth auth, semantic search)
- **Amazon Aurora MySQL**: Serverless v2 for CRM data (via RDS Data API)
- **Amazon Kinesis**: Data Stream and Firehose for streaming
- **AWS Lambda**: Data generation and processing
- **Amazon S3**: Data lake storage
- **AWS Glue**: Data catalog with partition projection
- **Amazon Athena**: SQL queries on data lake (auto-discovers partitions)
- **AWS Cognito**: Authentication (user auth + OAuth M2M for MCP servers)
- **Amazon CloudFront**: Frontend hosting

## Data Model

The agent reads from two independent data sources and can correlate across them.

**Athena** — database `acme_telemetry`, backed by the S3 data lake:

| Table | Description | Records |
|-------|-------------|---------|
| `streaming_events` | Telemetry events, partitioned by year/month/day/hour | Streaming + batch |
| `customers` | Customer profiles | 1,000 |
| `titles` | Video catalog | 500 |
| `campaigns` | Ad campaigns | 50 |

**Aurora MySQL** — database `acme_crm`, seeded on deploy via the RDS Data API:

| Table | Description | Records |
|-------|-------------|---------|
| `support_tickets` | Customer support tickets | ~200 |
| `content_ratings` | Content ratings and reviews | ~500 |

`customer_id` and `title_id` are shared across both sources, so questions like "what do
customers who filed billing tickets watch?" span Athena and Aurora in a single turn.

See the [data-stack README](data-stack/README.md) for full column-level schemas and
example SQL.

## Region

All resources are deployed in **us-west-2** (Oregon). The agent uses the
`global.anthropic.claude-haiku-4-5-20251001-v1:0` inference profile, which serves requests
cross-region. Change `agent.model` and `aws.region` in
`agent-stack/cdk/lib/config/index.ts` to deploy elsewhere, and confirm the model and
AgentCore are available in your target region first.

## Cost

This sample provisions resources that bill continuously while deployed, including Aurora
Serverless v2 (minimum ACU charged even when idle), a Kinesis Data Stream in On-Demand
mode, three AgentCore MCP runtimes plus the agent runtime, a CloudFront distribution, and
an EventBridge schedule that invokes the generator Lambda every 5 minutes. Athena and
Bedrock are charged per query and per token.

Run the [Cleanup](#cleanup) steps when you are finished to stop ongoing charges. Costs vary
by region and usage — use the [AWS Pricing Calculator](https://calculator.aws/) to estimate
for your account.

## Project Structure

```
sample-aws-semantic-data-access-ai-agents/
├── agent-stack/                    # AI Agent Infrastructure
│   ├── cdk/                        # CDK infrastructure
│   │   ├── lib/                    # Stack and constructs
│   │   └── docker/agent/           # Agent container code
│   ├── frontend/acme-chat/         # React TypeScript app
│   └── aws-mcp-server-agentcore/   # MCP server implementations
│       ├── aws-documentation-mcp-server/
│       ├── aws-dataprocessing-mcp-server/
│       └── aws-mysql-mcp-server/
│
└── data-stack/                     # Streaming Data Infrastructure
    └── consolidated-data-stack/    # Kinesis, Firehose, Glue, Lambdas
```

## Quick Start

### Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 18+ and npm
- Docker (for building container images)
- AWS CDK CLI (`npm install -g aws-cdk`)

### Verify Prerequisites (Run These First!)

Run the automated preflight check script from the repo root:

```bash
./preflight.sh
```

This validates all prerequisites and auto-fixes common issues (e.g., recreates CDK ECR repo if deleted out-of-band). Checks: AWS CLI, credentials, Docker, Node.js >= 18, npm, CDK CLI, CDK bootstrap stack, CDK ECR repo, frontend build, and jq. Run `./preflight.sh --help` for options.

<details>
<summary>Manual checks (if not using preflight.sh)</summary>

Verify all prerequisites are met:

```bash
# 1. Check Node.js version (must be 18+)
node --version
# Expected: v18.x.x or v20.x.x or higher

# 2. Check npm is available
npm --version
# Expected: 9.x.x or higher

# 3. Check Docker is running
docker info > /dev/null 2>&1 && echo "✓ Docker is running" || echo "✗ Docker is NOT running - start Docker Desktop"

# 4. Check AWS credentials are configured
aws sts get-caller-identity
# Expected: JSON with Account, UserId, Arn (if you see an error, run 'aws configure')

# 5. Check AWS region is set correctly
aws configure get region || echo "No default region set"
# Expected: us-west-2 (or set it with: export AWS_REGION=us-west-2)

# 6. Check CDK is installed
cdk --version
# Expected: 2.x.x (if missing: npm install -g aws-cdk)

# 7. Store your account ID for later use
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "Your AWS Account ID: $ACCOUNT"
```

**If any check fails, fix it before proceeding.** Common fixes:
- Docker not running → Start Docker Desktop
- AWS credentials error → Run `aws configure` or check your IAM permissions
- CDK not found → Run `npm install -g aws-cdk`
- Wrong Node version → Use nvm: `nvm install 20 && nvm use 20`

</details>

### Full Deployment (Both Stacks)

Deploy both stacks in order - data stack first (agent queries its Athena data).

> **Important**: Run each step and verify it succeeds before moving to the next. The frontend MUST be built before `cdk deploy` because the CDK stack references the `build/` directory.

```bash
# Set your account ID (used in later commands)
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "Deploying to account: $ACCOUNT"

#─────────────────────────────────────────────────────────────────────────────
# STEP 1: Deploy Data Stack (Kinesis, Firehose, S3, Glue, Athena)
#─────────────────────────────────────────────────────────────────────────────
cd data-stack/consolidated-data-stack
npm install
npm run build
cdk bootstrap   # First time only - safe to run again
cdk deploy --all --require-approval never

# ✓ VERIFY: Check data stack deployed successfully
aws cloudformation describe-stacks --stack-name AcmeKinesisStack --query 'Stacks[0].StackStatus' --output text --region us-west-2
# Expected: CREATE_COMPLETE or UPDATE_COMPLETE

#─────────────────────────────────────────────────────────────────────────────
# STEP 2: Build Frontend FIRST (required before CDK deploy)
#─────────────────────────────────────────────────────────────────────────────
cd ../../agent-stack/frontend/acme-chat
npm install
npm run build

# ✓ VERIFY: Check build folder exists and has files
ls -la build/index.html && echo "✓ Frontend build successful" || echo "✗ BUILD FAILED - do not proceed"

#─────────────────────────────────────────────────────────────────────────────
# STEP 3: Deploy Agent Stack (Cognito, Agent, MCP servers)
#─────────────────────────────────────────────────────────────────────────────
cd ../../cdk
npm install
cdk deploy AcmeAgentCoreStack --require-approval never

# ✓ VERIFY: Check agent stack deployed successfully
aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack --query 'Stacks[0].StackStatus' --output text --region us-west-2
# Expected: CREATE_COMPLETE or UPDATE_COMPLETE

#─────────────────────────────────────────────────────────────────────────────
# STEP 4: Deploy Frontend with correct config from CloudFormation
#─────────────────────────────────────────────────────────────────────────────
cd ../frontend/acme-chat
./scripts/deploy-frontend.sh

# ✓ VERIFY: Get the CloudFront URL
FRONTEND_URL=$(aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack \
  --query 'Stacks[0].Outputs[?OutputKey==`FrontendUrl`].OutputValue' --output text --region us-west-2)
echo "Frontend URL: $FRONTEND_URL"

#─────────────────────────────────────────────────────────────────────────────
# STEP 5: Create test user
#─────────────────────────────────────────────────────────────────────────────
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CognitoUserPoolId`].OutputValue' --output text --region us-west-2)

echo "Creating user in User Pool: $USER_POOL_ID"

aws cognito-idp admin-create-user --user-pool-id $USER_POOL_ID \
  --username user1@test.com --user-attributes Name=email,Value=user1@test.com Name=email_verified,Value=true \
  --message-action SUPPRESS --region us-west-2

aws cognito-idp admin-set-user-password --user-pool-id $USER_POOL_ID \
  --username user1@test.com --password 'Abcd1234@' --permanent --region us-west-2

# ✓ VERIFY: Check user was created successfully
aws cognito-idp admin-get-user --user-pool-id $USER_POOL_ID --username user1@test.com \
  --query 'UserStatus' --output text --region us-west-2
# Expected: CONFIRMED

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "✓ DEPLOYMENT COMPLETE"
echo "════════════════════════════════════════════════════════════════════"
echo "Frontend URL: $FRONTEND_URL"
echo "Login: user1@test.com / Abcd1234@"
echo ""
echo "Note: CloudFront may take 1-2 minutes to propagate. If you get errors,"
echo "      wait a moment and refresh the page."
echo "════════════════════════════════════════════════════════════════════"
```

### Generate Batch Data (Optional but Recommended)

The streaming pipeline generates data every 5 minutes. For immediate testing with substantial data:

```bash
cd data-stack/consolidated-data-stack

# Set account ID
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "Using account: $ACCOUNT"

# ✓ VERIFY: Check S3 bucket exists (created by data stack)
aws s3 ls s3://acme-telemetry-data-${ACCOUNT}-us-west-2/ > /dev/null 2>&1 \
  && echo "✓ S3 bucket exists" \
  || echo "✗ S3 bucket not found - deploy data stack first"

#─────────────────────────────────────────────────────────────────────────────
# Setup Python environment
#─────────────────────────────────────────────────────────────────────────────
python3 -m venv .venv
source .venv/bin/activate
pip install pandas pyarrow click tqdm boto3 faker

# ✓ VERIFY: Check Python packages installed
python -c "import pandas, pyarrow, faker; print('✓ Python packages installed')"

#─────────────────────────────────────────────────────────────────────────────
# Generate all data (customers, titles, campaigns, telemetry)
#─────────────────────────────────────────────────────────────────────────────
python data_generation/main.py --customers 1000 --titles 500 --telemetry 100000 --campaigns 50

# ✓ VERIFY: Check output files were created
ls -la output/
# Expected: telemetry/, customers/, titles/, campaigns/ directories

#─────────────────────────────────────────────────────────────────────────────
# Upload all tables to S3
#─────────────────────────────────────────────────────────────────────────────
aws s3 sync output/ s3://acme-telemetry-data-${ACCOUNT}-us-west-2/ --exclude "metadata.json"

# ✓ VERIFY: Check data uploaded
aws s3 ls s3://acme-telemetry-data-${ACCOUNT}-us-west-2/telemetry/ --recursive | head -5
echo "..."
aws s3 ls s3://acme-telemetry-data-${ACCOUNT}-us-west-2/telemetry/ --recursive | wc -l | xargs -I{} echo "Total files: {}"

# NOTE: No partition repair needed - Athena partition projection auto-discovers partitions

#─────────────────────────────────────────────────────────────────────────────
# Test Athena query
#─────────────────────────────────────────────────────────────────────────────
echo "Testing Athena query..."
TEST_QUERY_ID=$(aws athena start-query-execution \
  --query-string "SELECT COUNT(*) as total FROM acme_telemetry.streaming_events" \
  --work-group primary \
  --result-configuration "OutputLocation=s3://acme-telemetry-data-${ACCOUNT}-us-west-2/athena-results/" \
  --region us-west-2 \
  --query 'QueryExecutionId' --output text)

sleep 5
aws athena get-query-results --query-execution-id $TEST_QUERY_ID \
  --query 'ResultSet.Rows[1].Data[0].VarCharValue' --output text --region us-west-2 | xargs -I{} echo "✓ Total events in Athena: {}"
```

This creates 4 Athena tables: `streaming_events`, `customers`, `titles`, `campaigns`.

### Test Credentials

After deployment, access the CloudFront URL and login with:
- **Email**: `user1@test.com`
- **Password**: `Abcd1234@`

> **Demo only.** These credentials are hardcoded in this guide so the sample is easy to try,
> which also means they are public. Before using any of this beyond a throwaway demo:
> choose your own credentials, and set `developmentMode: false` in
> `agent-stack/cdk/bin/app.ts` (it ships as `true`, which applies DESTROY removal policies
> and auto-deletes S3 objects).

## Features

- **Conversation Memory**: Persistent chat history via AgentCore Memory
- **MCP Integration**: Query AWS docs, run Athena SQL queries, and access CRM database
- **MCP Gateway**: Unified tool access with OAuth authentication and semantic search
- **CRM Database**: Aurora MySQL Serverless v2 with support tickets and content ratings
- **Streaming Responses**: Real-time response streaming
- **Code Interpreter**: Python execution for charts and data visualization

## Sample Agent Queries

Once deployed with data, try these natural language queries:

### Telemetry Analytics
- "How many streaming events do we have?"
- "Show me events by device type"
- "What's the quality distribution of streams?"
- "Which countries have the most viewers?"
- "What's the average watch duration by device?"
- "Show hourly viewing patterns"
- "Which ISPs have the best streaming quality?"

### Customer Analytics (Athena)
- "How many customers do we have by subscription tier?"
- "What's the average lifetime value by country?"
- "Show me a breakdown of customers by subscription tier"

### Content Analytics
- "What are our top rated titles?"
- "Show me the genre distribution of our catalog"
- "Which content types have the highest popularity?"

### Campaign Analytics
- "How are our ad campaigns performing?"
- "What's the average CTR by campaign type?"
- "Show top campaigns by conversions"

### CRM Database (Aurora MySQL)
- "How many open support tickets do we have?"
- "Break down support tickets by priority and category"
- "Which titles have the highest average content rating?"
- "List recent customer support tickets"

### AWS Documentation
- "How do I create an S3 bucket with versioning?"
- "Explain Kinesis Data Streams vs Firehose"
- "What are the best practices for Lambda functions?"

### Data Visualization (Code Interpreter)
- "Create a bar chart of events by device type"
- "Plot the hourly distribution of streaming events"

## Outputs

After deploying the agent stack, you'll get:

| Output | Description |
|--------|-------------|
| `FrontendUrl` | CloudFront URL for the chat application |
| `AgentArn` | Main agent runtime ARN |
| `CognitoUserPoolId` | User pool ID for authentication |
| `CognitoAppClientId` | App client ID for frontend |
| `DiscoveryUrl` | OIDC discovery URL for JWT validation |
| `MemoryId` | AgentCore Memory resource ID |
| `DeploymentSummary` | Summary of key deployed resources |

Aurora, Gateway, and OAuth provider details are emitted as construct-scoped outputs whose
keys carry a CDK-generated hash suffix. Match them by substring, as the commands in this
guide do (`?contains(OutputKey,`ClusterArn`)`), or list all keys with:

```bash
aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack --region us-west-2 \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' --output table
```

## Troubleshooting

### Common Deployment Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Cannot find asset at .../build` | Frontend not built before CDK deploy | Run `cd agent-stack/frontend/acme-chat && npm run build` first |
| `CDK bootstrap required` | First deployment to this account/region | Run `cdk bootstrap aws://ACCOUNT_ID/us-west-2` |
| `Docker daemon is not running` | Docker Desktop not started | Start Docker Desktop and wait for it to initialize |
| `Unable to locate credentials` | AWS CLI not configured | Run `aws configure` or set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY |
| `User already exists` | Test user already created | Skip user creation or use different email |
| `Stack AcmeAgentCoreStack does not exist` | Agent stack not deployed | Deploy agent stack first with `cdk deploy AcmeAgentCoreStack` |
| CDK deploy fails after ECR repo deleted | `cdk-hnb659fds-container-assets-*` ECR repo deleted out-of-band | Run `./preflight.sh` (auto-fixes) or manually: `aws ecr create-repository --repository-name cdk-hnb659fds-container-assets-ACCOUNT-REGION` |
| `HIVE_CURSOR_ERROR in Athena` | Schema mismatch | See data-stack README for table recreation SQL |
| First Athena query very slow (~3.5 min) | Partition projection scans ~62K virtual partitions (year range 2024-2030) | Expected on first query after deploy. Subsequent queries are fast |

### Quick Diagnostic Commands

```bash
# Check all prerequisites at once (recommended)
./preflight.sh

# Or check manually:

# Check stack status
aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack \
  --query 'Stacks[0].{Status:StackStatus,Reason:StackStatusReason}' --output table --region us-west-2

# Check for deployment errors in CloudFormation events
aws cloudformation describe-stack-events --stack-name AcmeAgentCoreStack \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table --region us-west-2

# Check agent logs for runtime errors
aws logs tail /aws/bedrock-agentcore/runtimes/acme_chatbot --region us-west-2 --since 10m 2>/dev/null || echo "No agent logs yet"
```

### Frontend Build Fails

```bash
# Clean and rebuild
cd agent-stack/frontend/acme-chat
rm -rf node_modules build
npm install
npm run build

# If TypeScript errors, check Node version
node --version  # Should be 18+
```

### CDK Synthesis Fails

```bash
# Check for TypeScript errors
cd agent-stack/cdk
npm run build  # Should complete without errors

# If errors, try clean install
rm -rf node_modules
npm install
npm run build
```

## Cleanup

To delete all resources:

```bash
# Destroy data stack
cd data-stack/consolidated-data-stack
cdk destroy --all --force

# Destroy agent stack
cd ../../agent-stack/cdk
cdk destroy AcmeAgentCoreStack --force

# Kinesis Data Stream may not be deleted by CDK - delete manually if needed
aws kinesis delete-stream --stream-name acme-telemetry-stream --region us-west-2

# Clean up orphaned CloudWatch log groups
for log_group in $(aws logs describe-log-groups --region us-west-2 \
  --query 'logGroups[?contains(logGroupName, `acme`)].logGroupName' --output text); do
  aws logs delete-log-group --log-group-name "$log_group" --region us-west-2
done
```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
