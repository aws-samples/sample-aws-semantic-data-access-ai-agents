# Agent Stack

AI agent infrastructure built with AWS Bedrock AgentCore and MCP (Model Context Protocol) integration.

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│   React App     │────▶│  Bedrock AgentCore   │────▶│  MCP Gateway     │
│   (CloudFront)  │     │  (Claude Haiku 4.5)  │     │  (Semantic Search)│
└─────────────────┘     └──────────────────────┘     └────────┬─────────┘
        │                        │                            │
        ▼                        ▼                   ┌────────▼─────────┐
┌─────────────────┐     ┌──────────────────────┐     │   MCP Servers    │
│  AWS Cognito    │     │  AgentCore Memory    │     │  (Cognito OAuth) │
│  (Auth)         │     │  (Conversation)      │     │  - AWS Docs      │
└─────────────────┘     └──────────────────────┘     │  - Data Process  │
                                                     │  - MySQL CRM     │
                                                     └──────────────────┘
```

## Components

### Frontend (`frontend/acme-chat/`)
React TypeScript application with:
- AWS Cognito authentication (USER_PASSWORD_AUTH flow)
- Real-time streaming chat interface
- Markdown rendering with syntax highlighting
- Image rendering (S3 presigned URLs)

### CDK Infrastructure (`cdk/`)
AWS CDK stack that deploys:
- Cognito User Pool for authentication (2 clients: frontend public, MCP confidential)
- Main Agent Runtime (Claude Haiku 4.5 + AgentCore Memory)
- MCP Gateway (semantic search, OAuth outbound auth via Token Vault)
- 3 MCP Servers (AWS Docs, Data Processing, MySQL CRM)
- AgentCore Memory (with summarization strategy, 90-day event expiry)
- OAuth Provider (Token Vault credential provider)
- Aurora MySQL Serverless v2 (`acme_crm` CRM database, seeded via RDS Data API)
- S3 + CloudFront for frontend

### MCP Servers (`aws-mcp-server-agentcore/`)
Model Context Protocol servers running on AgentCore Runtime:

| Server | Description | Key Tools |
|--------|-------------|-----------|
| `aws-documentation-mcp-server/` | Search AWS documentation | `read_documentation`, `search_documentation`, `recommend` |
| `aws-dataprocessing-mcp-server/` | Athena SQL on telemetry data lake | Glue, EMR, Athena management |
| `aws-mysql-mcp-server/` | Aurora MySQL CRM via RDS Data API | `run_query`, `get_table_schema` |

> The MySQL server has no vendored source — its `Dockerfile` installs the upstream
> `awslabs.mysql-mcp-server` package and generates an AgentCore wrapper that runs it in
> stateless HTTP mode against the RDS Data API.

## Project Structure

```
agent-stack/
├── cdk/                          # CDK infrastructure
│   ├── lib/
│   │   ├── acme-stack.ts         # Main stack
│   │   ├── config/               # Configuration
│   │   └── constructs/           # CDK constructs
│   │       ├── agent-runtime-construct.ts
│   │       ├── aurora-construct.ts
│   │       ├── cognito-construct.ts
│   │       ├── frontend-construct.ts
│   │       ├── gateway-construct.ts
│   │       ├── mcp-server-construct.ts
│   │       ├── memory-construct.ts
│   │       ├── oauth-provider-construct.ts
│   │       └── secrets-construct.ts
│   └── docker/
│       └── agent/                # Agent container
│           ├── strands_claude.py # Main agent code
│           └── Dockerfile
├── frontend/
│   └── acme-chat/                # React TypeScript app
│       ├── src/
│       │   ├── components/       # React components
│       │   └── services/         # API services
│       └── scripts/
│           ├── deploy-frontend.sh   # Build + deploy to S3/CloudFront
│           └── generate-env.sh      # Generate .env from CloudFormation
└── aws-mcp-server-agentcore/     # MCP server implementations
    ├── aws-documentation-mcp-server/
    ├── aws-dataprocessing-mcp-server/
    └── aws-mysql-mcp-server/
```

## Deployment

> **For deployment instructions, see the [main README](../README.md) in the repository root.**
>
> The main README contains the complete step-by-step deployment guide with verification checks.

### Frontend Deploy Script

`deploy-frontend.sh` automates production deployment:
1. Fetches Cognito/Agent config from CloudFormation outputs
2. Generates `.env` with correct values
3. Builds the production bundle
4. Syncs to S3 bucket
5. Invalidates CloudFront cache

> After deployment, wait 1-2 minutes for CloudFront cache invalidation to complete before testing.

## Configuration

Configuration is managed in `cdk/lib/config/index.ts`:

| Variable | Default | Description |
|----------|---------|-------------|
| `aws.region` | `us-west-2` | AWS deployment region |
| `agent.runtimeName` | `acme_chatbot` | Main agent runtime name |
| `agent.model` | `global.anthropic.claude-haiku-4-5-20251001-v1:0` | Bedrock model (Claude Haiku 4.5, global cross-region inference) |
| `agent.memory.expirationDays` | `90` | AgentCore Memory event retention |
| `cognito.userPoolName` | `acme-corp-agentcore-users` | Cognito User Pool name |
| `aws.platform` | `linux/arm64` | Docker build platform for agent and MCP images |

## CDK Commands

```bash
# Synthesize CloudFormation template
cdk synth

# Compare deployed stack with current state
cdk diff

# Deploy stack
cdk deploy AcmeAgentCoreStack

# Destroy stack
cdk destroy AcmeAgentCoreStack

# List stacks
cdk list
```

> **Tip**: Set `developmentMode: true` in `bin/app.ts` for DESTROY removal policy, auto-delete S3 objects, and detailed CloudFormation outputs (useful for iterative development).

## Stack Outputs

Stack-level outputs (stable logical IDs, safe to query by exact name):

| Output | Description |
|--------|-------------|
| `FrontendUrl` | CloudFront distribution URL |
| `AgentArn` | Main agent runtime ARN |
| `CognitoUserPoolId` | Cognito User Pool ID |
| `CognitoAppClientId` | Frontend app client ID |
| `DiscoveryUrl` | OIDC discovery URL for JWT validation |
| `MemoryId` | AgentCore Memory resource ID |
| `DeploymentSummary` | Summary of key deployed resources |

Construct-level outputs are also emitted (Aurora `ClusterArn`/`SecretArn`/`DatabaseName`, `GatewayId`/`GatewayArn`, `OAuthProviderArn`, `McpCredentialsArn`, and the Cognito/Frontend/Agent outputs). CDK prefixes these with the construct ID and appends a hash suffix (e.g. `Aurora` + `ClusterArn` + hash), so look them up with a substring match rather than an exact name:

```bash
aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack --region us-west-2 \
  --query 'Stacks[0].Outputs[?contains(OutputKey,`ClusterArn`)].OutputValue' --output text

# Or list every output key to see the generated names
aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack --region us-west-2 \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' --output table
```

## Features

- **Conversation Memory**: Persistent conversation history via AgentCore Memory (with summarization strategy, 90-day event expiry)
- **MCP Gateway**: Unified tool access via AgentCore Gateway with semantic search and OAuth outbound auth
- **MCP Integration**: 3 MCP servers for AWS docs, Athena data queries, and Aurora MySQL CRM
- **Streaming Responses**: Real-time response streaming
- **Code Interpreter**: Python code execution for data visualization

## Automated Safeguards

| Safeguard | Description |
|-----------|-------------|
| **MCP Secret Sync** | Custom Resource syncs Cognito client secret to Secrets Manager on every deploy |
| **5-min Secret Cache** | Agent re-fetches secrets from Secrets Manager every 5 minutes |
| **Auto-regenerate .env** | `deploy-frontend.sh` fetches fresh config from CloudFormation |

## Logs

```bash
# Agent runtime logs (log group has -DEFAULT suffix; runtime ID changes per deploy)
aws logs tail /aws/bedrock-agentcore/runtimes/acme_chatbot-<RUNTIME_ID>-DEFAULT --region us-west-2 --since 10m --format short

# Filter for real errors (exclude OTEL noise)
aws logs tail /aws/bedrock-agentcore/runtimes/acme_chatbot-<RUNTIME_ID>-DEFAULT --region us-west-2 --since 10m --format short 2>&1 | grep -v 'otel-rt-logs' | grep -iE 'ERROR|WARN|Exception|fail|denied'

# MCP server logs
aws logs tail /aws/bedrock-agentcore/runtimes/dataproc_mcp-<ID>-DEFAULT --region us-west-2 --since 10m --format short
aws logs tail /aws/bedrock-agentcore/runtimes/aws_docs_mcp-<ID>-DEFAULT --region us-west-2 --since 10m --format short
aws logs tail /aws/bedrock-agentcore/runtimes/mysql_mcp-<ID>-DEFAULT --region us-west-2 --since 10m --format short
```

> Runtime IDs change on each deploy. Find current IDs in CloudWatch log groups or CloudFormation outputs.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `Cannot find asset at .../build` | Frontend not built | Build frontend first: `cd frontend/acme-chat && npm run build` |
| `CDK bootstrap required` | First deploy to account/region | Run `cdk bootstrap aws://ACCOUNT/us-west-2` |
| `Docker daemon is not running` | Docker not started | Start Docker Desktop |
| Login fails after stack recreation | Stale `.env` config | Run `./scripts/deploy-frontend.sh` to regenerate |
| MCP initialization fails | Stale client secret | Redeploy: `cdk deploy AcmeAgentCoreStack` |

### Test Cognito Authentication

```bash
aws cognito-idp initiate-auth \
  --client-id <AppClientId> \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters 'USERNAME=user1@test.com,PASSWORD=Abcd1234@' \
  --region us-west-2
```

## CRM Database Schema

**Database**: `acme_crm` (Aurora MySQL Serverless v2, seeded by `lambda/aurora-init/index.py`)

| Table | Description | Rows seeded |
|-------|-------------|-------------|
| `support_tickets` | Customer support tickets | ~200 |
| `content_ratings` | Content ratings and reviews | ~500 |

- `support_tickets.status`: `open`, `in_progress`, `resolved`, `closed`
- `support_tickets.priority`: `low`, `medium`, `high`, `critical`
- `support_tickets.category`: `billing`, `technical`, `content`, `account`
- `content_ratings.rating`: integer 1–5
- `customer_id` / `title_id` link to the Athena `customers` and `titles` tables for
  cross-database correlation

## Security Considerations

- Cognito User Pool uses email verification with a strong password policy
- MCP client secret stored in Secrets Manager (never in code)
- Frontend S3 bucket has all public access blocked
- CloudFront enforces HTTPS redirect
- Non-root user in Docker containers
- IAM policies follow least privilege

> **Demo credentials**: the deployment guide creates a test user with a well-known
> password and `bin/app.ts` ships with `developmentMode: true` (DESTROY removal policies).
> Both are for demonstration only — change the credentials and set `developmentMode: false`
> before any non-demo use.

## Security

See [CONTRIBUTING](../CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the [LICENSE](../LICENSE) file.
