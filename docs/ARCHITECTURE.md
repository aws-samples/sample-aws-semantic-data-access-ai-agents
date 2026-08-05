# Architecture and Reference

Architecture, data model, and troubleshooting for the AWS semantic data access sample.
For setup and deployment, see the [main README](../README.md).

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

See the [data-stack README](../data-stack/README.md) for full column-level schemas and
example SQL.

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

## Security

See [CONTRIBUTING](../CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the [LICENSE](../LICENSE) file.
