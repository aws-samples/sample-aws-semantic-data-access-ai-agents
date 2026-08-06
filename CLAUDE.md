# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AWS Bedrock AgentCore demonstration with MCP (Model Context Protocol) integration. The project showcases an ACME Corp chatbot that can query AWS documentation, analyze streaming telemetry data, and query CRM data via natural language.

**Region**: us-west-2 | **Model**: `global.anthropic.claude-haiku-4-5-20251001-v1:0` (cross-region profile) | **Docker Platform**: linux/arm64

## Git Workflow

Private repo (`aws-samples/sample-aws-semantic-data-access-ai-agents`), main-only. Commit and push directly to `main` — do not create feature branches.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              USER                                         │
│                                │                                          │
│                                ▼                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                    AGENT STACK (agent-stack/)                       │  │
│  │                                                                     │  │
│  │   CloudFront ──▶ Cognito ──▶ Bedrock AgentCore Runtime              │  │
│  │   (React App)    (Auth)      (Claude Haiku 4.5 + Memory)            │  │
│  │                                       │                             │  │
│  │                              ┌────────▼────────┐                    │  │
│  │                              │  AgentCore       │                    │  │
│  │                              │  MCP Gateway     │                    │  │
│  │                              │  (Semantic Search)│                   │  │
│  │                              └───────┬──────────┘                   │  │
│  │                    ┌─────────────────┼─────────────────┐            │  │
│  │                    │        MCP Servers (Cognito OAuth)         │            │  │
│  │                    │  ┌──────────┐ ┌───────────┐ ┌───────────┐│            │  │
│  │                    │  │ AWS Docs │ │ Data Proc │ │ MySQL MCP ││            │  │
│  │                    │  │ MCP      │ │ MCP       │ │ (CRM)     │├────────┐   │  │
│  │                    │  └──────────┘ └─────┬─────┘ └─────┬─────┘│        │   │  │
│  │                    └─────────────────────┼─────────────┼──────┘        │   │  │
│  │                                          │             │               │   │  │
│  │                                   Athena Queries   RDS Data API        │   │  │
│  │                                          │             │               │   │  │
│  │                                          │     ┌───────▼──────┐        │   │  │
│  │                                          │     │ Aurora MySQL │        │   │  │
│  │                                          │     │ Serverless v2│        │   │  │
│  │                                          │     │ (default VPC)│        │   │  │
│  │                                          │     └──────────────┘        │   │  │
│  └──────────────────────────────────────────┼────────────────────────────┼───┘  │
│                                              │                            │      │
│                                    Athena Queries                         │      │
│                                                                    │      │
│  ┌─────────────────────────────────────────────────────────────────┼───┐  │
│  │                    DATA STACK (data-stack/)                     │   │  │
│  │                                                                 ▼   │  │
│  │   EventBridge ──▶ Lambda ──▶ Kinesis ──▶ Firehose ──▶ S3 Data Lake  │  │
│  │   (5 min)         (Generator)  (Stream)              (Glue + Athena)│  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

## Build & Deploy Commands

### Agent Stack
```bash
# Run preflight checks first
./preflight.sh

cd agent-stack/cdk
npm install

# IMPORTANT: Frontend must be built first (CDK references build/ directory)
cd ../frontend/acme-chat && npm install && npm run build && cd ../../cdk

# Deploy CDK stack (Cognito, Agent, MCP servers)
cdk deploy AcmeAgentCoreStack

# Deploy frontend (auto-generates .env from CloudFormation)
cd ../frontend/acme-chat
./scripts/deploy-frontend.sh
```

### Frontend Development
```bash
cd agent-stack/frontend/acme-chat
npm install
npm start          # Dev server on localhost:3000
npm run build      # Production build
```

### Data Stack
```bash
cd data-stack/consolidated-data-stack
npm install
npm run build
cdk deploy --all
```

### Create Test User (after stack deploy)
```bash
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CognitoUserPoolId`].OutputValue' --output text --region us-west-2)

aws cognito-idp admin-create-user --user-pool-id $USER_POOL_ID \
  --username user1@test.com --user-attributes Name=email,Value=user1@test.com Name=email_verified,Value=true \
  --message-action SUPPRESS --region us-west-2

aws cognito-idp admin-set-user-password --user-pool-id $USER_POOL_ID \
  --username user1@test.com --password 'Abcd1234@' --permanent --region us-west-2
```

## Key Files

| Path | Purpose |
|------|---------|
| `agent-stack/cdk/lib/acme-stack.ts` | Main CDK stack orchestrating all constructs |
| `agent-stack/cdk/lib/config/index.ts` | Central configuration (region, naming, Cognito, model) |
| `agent-stack/cdk/lib/constructs/secrets-construct.ts` | MCP credentials sync (Custom Resource) |
| `agent-stack/cdk/lib/constructs/gateway-construct.ts` | MCP Gateway (unified tool access point) |
| `agent-stack/cdk/lib/constructs/oauth-provider-construct.ts` | OAuth2 credential provider (Token Vault Custom Resource) |
| `agent-stack/cdk/docker/agent/strands_claude.py` | Main agent logic with MCP client management |
| `agent-stack/frontend/acme-chat/src/services/AuthService.ts` | Cognito auth (USER_PASSWORD_AUTH flow) |
| `agent-stack/frontend/acme-chat/src/services/AgentCoreService.ts` | Agent invocation API client |
| `agent-stack/cdk/docker/agent/memory_manager.py` | AgentCore Memory integration (short-term, 7-day expiry) |
| `agent-stack/cdk/docker/agent/secrets_manager.py` | Secrets Manager client with 5-min TTL cache |
| `agent-stack/cdk/lib/constructs/aurora-construct.ts` | Aurora MySQL Serverless v2 + DB seeding Custom Resource |
| `agent-stack/cdk/lambda/aurora-init/index.py` | Lambda that seeds acme_crm database via RDS Data API |
| `agent-stack/frontend/acme-chat/src/config.ts` | Frontend config (reads REACT_APP_* env vars) |
| `data-stack/consolidated-data-stack/lib/config.ts` | Data stack configuration |

**Docs**: verify README claims against config/code, not other docs. `acme_crm` has exactly two tables — whatever `lambda/aurora-init/index.py` creates (`support_tickets`, `content_ratings`). Glue table columns come from `data-lake-stack.ts`, not the README.

## MCP Servers

Located in `agent-stack/aws-mcp-server-agentcore/`:
- **aws-documentation-mcp-server**: Search AWS documentation
- **aws-dataprocessing-mcp-server**: Athena SQL queries on ACME telemetry data
- **aws-mysql-mcp-server**: MySQL queries on Aurora MySQL CRM data (via RDS Data API)

## MCP Gateway

The agent accesses all MCP tools through a single AgentCore Gateway (`gateway-construct.ts`):
- **Inbound auth**: Cognito JWT (same credentials as direct MCP access)
- **Outbound auth**: OAuth2 via Token Vault credential provider (Cognito client_credentials flow). Gateway role needs `GetWorkloadAccessToken` + `GetResourceOauth2Token` + `secretsmanager:GetSecretValue`
- **Important**: Gateway targets for MCP servers require `GatewayCredentialProvider.fromOauthIdentityArn()`, NOT `fromIamRole()`
- **Protocol**: MCP with semantic search for tool discovery
- **Tool naming**: Gateway prefixes tools with target name: `{target-name}___{tool-name}` (triple underscore, e.g., `mysql-mcp___run_query`)
- Gateway URL passed to agent as `GATEWAY_MCP_URL` environment variable
- Agent falls back to direct MCP connections if `GATEWAY_MCP_URL` is not set
- **Tool pagination**: Gateway `tools/list` returns 30 tools per page with `nextCursor`. Strands `list_tools_sync()` does NOT auto-paginate — must loop with `pagination_token` or pass MCPClient directly to `Agent(tools=[client])` which calls `load_tools()` internally with auto-pagination

## Important Implementation Details

### Authentication
- Frontend uses direct Cognito API with `USER_PASSWORD_AUTH` flow (not Hosted UI)
- MCP servers use OAuth with dedicated Cognito client (`AcmeMcpClientId`)
- MCP credentials synced to Secrets Manager via CDK Custom Resource on every deploy
- Agent caches secrets for 5 minutes (TTL in `secrets_manager.py`)

### MCP Server Invocation (Legacy/Fallback)

> Note: With the Gateway integration, direct MCP server invocation is a fallback path. The primary path is through the MCP Gateway.

- **Accept Header**: Must include `application/json, text/event-stream` or get 406 error
- **SSE Response**: MCP responses are Server-Sent Events format
- **Session ID**: Capture `mcp-session-id` header from initialize response
- **Bearer Token**: OAuth client_credentials flow via Cognito domain, cached for 50 minutes

### Teardown
- Verified E2E in us-west-2 (2026-08-05): all 4 stacks deploy and destroy cleanly, zero DELETE_FAILED
- Survives `cdk destroy` and needs manual cleanup: Kinesis `acme-telemetry-stream`, all `acme`/`Acme` log groups, and any runtime-created `ACMEChatMemory_*`
- `aws logs` `contains()` is case-sensitive — match both `acme` and `Acme` or the `AcmeAgentCoreStack-*` Lambda log groups are missed
- `aws-cli` v2 has NO `bedrock-agentcore-control` command — use boto3 to list/delete runtimes, gateways, and memories
- This account holds unrelated resources (Neptune, `cmcd-data-stream`, `fts-media-stream`, `smart-home-events`, other AgentCore runtimes/gateways) — never bulk-delete by loose name match

### CloudFormation Outputs
- Outputs declared inside constructs (Aurora `ClusterArn`/`SecretArn`/`DatabaseName`, `GatewayId`, `OAuthProviderArn`) get a CDK hash suffix — query with ``?contains(OutputKey,`X`)``, never an exact name. Only stack-level outputs (`FrontendUrl`, `AgentArn`, `CognitoUserPoolId`, `CognitoAppClientId`, `DiscoveryUrl`, `MemoryId`) have stable keys
- `agent-stack/cdk/bin/app.ts` ships `developmentMode: true` (DESTROY removal policies, auto-delete S3) — set false for anything non-demo

### Memory
- Event expiry is 90 days (`Config.agent.memory.expirationDays`)
- `memory_manager.py` uses the CDK memory via the `MEMORY_ID` env var. Only when `MEMORY_ID` is empty does it create an `ACMEChatMemory_<md5(actor_id)>` resource at runtime — that fallback is NOT owned by CloudFormation and survives `cdk destroy`
- Memory requires at least one strategy (e.g. `MemoryStrategy.usingBuiltInSummarization()`) for data plane operations (CreateEvent/ListEvents). Empty `strategies: []` causes "Memory status is not active" errors
- Available built-in strategies: `usingBuiltInSummarization()`, `usingBuiltInSemantic()`, `usingBuiltInUserPreference()`

### Debugging MCP Tools
- **Direct MCP server test** (bypasses gateway): `curl -X POST` with JSON-RPC `tools/list` to runtime endpoint — confirms server returns tools independently of gateway indexing
- **Gateway pagination check**: Send `tools/list` to gateway URL, check for `nextCursor` in response — tools beyond page 1 (30 per page) require pagination
- **`awslabs.mysql-mcp-server`**: No EULA needed. Tools (`run_query`, `get_table_schema`) registered unconditionally via `@mcp.tool()` decorators at module import

### Frontend-Agent Communication
- Session metadata embedded in prompt as `[META:{"sid":"...","uid":"..."}]` prefix
- Agent parses and strips this prefix in `memory_manager.py:extract_session_info()`
- Frontend env vars (`REACT_APP_*`) generated by `scripts/generate-env.sh` from CloudFormation outputs
- Required env vars: `REACT_APP_COGNITO_USER_POOL_ID`, `REACT_APP_COGNITO_APP_CLIENT_ID`, `REACT_APP_AGENTCORE_ARN`

### Data Stack
- **Kinesis**: On-Demand mode (auto-scales), 24hr retention
- **Firehose**: Delivers to S3 with Hive partitioning, 64MB buffer minimum (required for Parquet conversion)
- **Generator Lambda**: EventBridge scheduled (5 min), 1000 events per batch
- **Partition projection**: Enabled on `streaming_events` table — Athena auto-discovers partitions without `MSCK REPAIR TABLE` or Glue crawlers
- **Firehose stream name**: `acme-data-kinesis-to-s3` (writes to `s3://{bucket}/telemetry/year=.../month=.../day=.../hour=.../`)

## Logs
```bash
# Runtime IDs change per deploy — find current log groups:
aws logs describe-log-groups --log-group-name-prefix /aws/bedrock-agentcore/runtimes/ \
  --region us-west-2 --query 'logGroups[*].logGroupName' --output text

# Agent runtime logs (log group has -DEFAULT suffix)
aws logs tail /aws/bedrock-agentcore/runtimes/acme_chatbot-f6ZftiByME-DEFAULT --region us-west-2 --since 10m --format short

# Filter for real errors (exclude OTEL telemetry noise)
aws logs tail /aws/bedrock-agentcore/runtimes/acme_chatbot-f6ZftiByME-DEFAULT --region us-west-2 --since 10m --format short 2>&1 | grep -v 'otel-rt-logs' | grep -iE 'ERROR|WARN|Exception|Traceback|fail|denied'

# MySQL MCP server logs (filter out PingRequest noise)
aws logs tail /aws/bedrock-agentcore/runtimes/mysql_mcp-Ve7mMS7AuK-DEFAULT --region us-west-2 --since 10m --format short 2>&1 | grep -ivE 'PingRequest|Terminating session'

# Data generator Lambda
aws logs tail /aws/lambda/acme-data-generator --region us-west-2 --since 10m

# Extract actual tool call errors from OTEL telemetry (e.g. AccessDenied, InvalidRequest)
aws logs filter-log-events --log-group-name /aws/bedrock-agentcore/runtimes/acme_chatbot-QwwYAI4deZ-DEFAULT \
  --region us-west-2 --start-time $(python3 -c "import time; print(int((time.time()-900)*1000))") \
  --filter-pattern "AccessDenied" --query 'events[].message' --output text
```

## Athena Schema

**Database**: `acme_telemetry`

| Table | Description |
|-------|-------------|
| `streaming_events` | Telemetry data (partitioned by year/month/day/hour). **Note:** First query after deploy is slow (~3.5 min) because partition projection scans ~62K virtual partitions (year range 2024-2030). Subsequent queries are fast. |
| `customers` | Customer profiles (1000 records) |
| `titles` | Video catalog (500 records) |
| `campaigns` | Ad campaigns (50 records) |

| Column | Type | Values |
|--------|------|--------|
| event_type | STRING | 'start', 'pause', 'resume', 'stop', 'complete' |
| title_type | STRING | 'movie', 'series', 'documentary' |
| device_type | STRING | 'mobile', 'web', 'tv', 'tablet' |

## Aurora MySQL Schema

**Database**: `acme_crm` (Aurora MySQL Serverless v2, accessed via RDS Data API)

| Table | Description |
|-------|-------------|
| `support_tickets` | Customer support tickets (200 records) |
| `content_ratings` | Content ratings and reviews (500 records) |

Key columns and enums:
- `support_tickets.status`: open, in_progress, resolved, closed
- `support_tickets.priority`: low, medium, high, critical
- `support_tickets.category`: billing, technical, content, account
- `content_ratings.rating`: 1-5 (integer)
- `customer_id` links to `acme_telemetry.customers` for cross-database correlation
- Subscription data is available in Athena (`acme_telemetry.customers.subscription_tier`)

## Batch Data Generation

Generate and upload historical telemetry data for Athena queries:
```bash
cd data-stack/consolidated-data-stack
python3 -m venv .venv && source .venv/bin/activate
pip install pandas pyarrow click tqdm boto3 faker

# Set account ID
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# Generate data (adjust counts as needed)
python data_generation/main.py --customers 1000 --titles 500 --telemetry 100000 --campaigns 50

# Upload to S3 (partition format must match Glue: year=/month=/day=/hour=)
aws s3 sync output/ s3://acme-telemetry-data-${ACCOUNT}-us-west-2/ --exclude "metadata.json"

# Configure Athena workgroup with query result location and enforce it (required before any queries work)
aws athena update-work-group --work-group primary \
  --configuration-updates "ResultConfigurationUpdates={OutputLocation=s3://acme-telemetry-data-${ACCOUNT}-us-west-2/athena-results/},EnforceWorkGroupConfiguration=true" \
  --region us-west-2
```

**Gotchas:**
- Glue table expects Hive partitioning (`year=/month=/day=/hour=`) - convert from `date=YYYYMMDD` if needed
- If Athena fails with `HIVE_CURSOR_ERROR`, recreate table via DDL to match parquet schema exactly
- Parquet files must NOT contain partition columns in data (only in path)
- Athena queries require `--result-configuration OutputLocation=s3://bucket/athena-results/`
- macOS requires venv for pip: `python3 -m venv venv && source venv/bin/activate`
- Datetime/date columns must be strings in Parquet for Athena compatibility

## Stack Recreate Checklist

When deleting and recreating the agent stack:
1. Run preflight checks: `./preflight.sh`
2. Build frontend first: `cd agent-stack/frontend/acme-chat && npm install && npm run build`
3. `cd ../../cdk && cdk deploy AcmeAgentCoreStack` - deploys infrastructure + syncs MCP secrets
4. Create test user (Cognito User Pool is new)
5. `./scripts/deploy-frontend.sh` - regenerates .env from CloudFormation outputs
6. Configure Athena workgroup output location and generate batch data (see Batch Data Generation section)

### Full Deploy (Both Stacks)
```bash
# Preflight checks
./preflight.sh

# Data stack first (agent queries Athena data)
cd data-stack/consolidated-data-stack && npm install && npm run build && cdk deploy --all

# Agent stack (requires frontend build first)
cd ../../agent-stack/frontend/acme-chat && npm install && npm run build
cd ../../cdk && npm install && cdk deploy AcmeAgentCoreStack
cd ../frontend/acme-chat && ./scripts/deploy-frontend.sh
```

All safeguards are automated - no manual secret sync needed.

## Deployment Verification

Quick checks to verify deployment is working:

```bash
# Set account
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# Check stacks deployed
aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack --query 'Stacks[0].StackStatus' --output text --region us-west-2
aws cloudformation describe-stacks --stack-name AcmeKinesisStack --query 'Stacks[0].StackStatus' --output text --region us-west-2

# Get frontend URL
aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack \
  --query 'Stacks[0].Outputs[?OutputKey==`FrontendUrl`].OutputValue' --output text --region us-west-2

# Test Cognito auth
CLIENT_ID=$(aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CognitoAppClientId`].OutputValue' --output text --region us-west-2)
aws cognito-idp initiate-auth --client-id $CLIENT_ID --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters 'USERNAME=user1@test.com,PASSWORD=Abcd1234@' --region us-west-2 \
  --query 'AuthenticationResult.AccessToken' --output text | head -c 20 && echo "... ✓"

# Test Athena data
aws athena start-query-execution --query-string "SELECT COUNT(*) FROM acme_telemetry.streaming_events" \
  --work-group primary --result-configuration "OutputLocation=s3://acme-telemetry-data-${ACCOUNT}-us-west-2/athena-results/" \
  --region us-west-2

# Test Aurora MySQL CRM data
CLUSTER_ARN=$(aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack \
  --query 'Stacks[0].Outputs[?contains(OutputKey,`ClusterArn`)].OutputValue' --output text --region us-west-2)
SECRET_ARN=$(aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack \
  --query 'Stacks[0].Outputs[?contains(OutputKey,`SecretArn`)].OutputValue' --output text --region us-west-2)
aws rds-data execute-statement --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" \
  --database acme_crm --sql "SELECT COUNT(*) as cnt FROM support_tickets" --region us-west-2
```

## Common Deployment Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot find asset at .../build` | Frontend not built | Run `npm run build` in frontend/acme-chat first |
| `Docker daemon is not running` | Docker not started | Start Docker Desktop |
| `CDK bootstrap required` | First deploy | Run `cdk bootstrap aws://ACCOUNT/us-west-2` |
| CDK deploy fails after ECR repo deleted out-of-band | `cdk-hnb659fds-container-assets-*` ECR repo was deleted but bootstrap thinks it exists | Run `./preflight.sh` (auto-fixes) or manually: `aws ecr create-repository --repository-name cdk-hnb659fds-container-assets-ACCOUNT-REGION` |
| `HIVE_CURSOR_ERROR` | Schema mismatch | See data-stack README for table recreation |
| `Domain already associated with another user pool` | Cognito domain prefix is globally unique across all AWS accounts | Append account ID to domain prefix: `${prefix}-${Stack.of(this).account}` |
| `MCP server target only supports OAUTH credential provider type` | Gateway targets for MCP servers cannot use IAM auth | Create OAuth2 credential provider in Token Vault, use `GatewayCredentialProvider.fromOauthIdentityArn()` |
| `secretsmanager:CreateSecret` unauthorized | `CreateOauth2CredentialProvider` API internally creates a Secrets Manager secret | Add `secretsmanager:CreateSecret/UpdateSecret/DeleteSecret/GetSecretValue/DescribeSecret/PutSecretValue` to Lambda role |
| `bedrock-agentcore:CreateTokenVault` unauthorized | OAuth provider creation requires Token Vault to exist first | Add `bedrock-agentcore:CreateTokenVault` and `GetTokenVault` permissions |
| `Vendor response doesn't contain ProviderArn attribute` | CDK Provider Custom Resources must return a dict, not call `cfnresponse.send()` | Return `{'Data': {'Key': 'value'}}` from Lambda handler |
| Memory stuck in CREATING during rollback | AgentCore Memory in transitional state cannot be deleted | `aws bedrock-agentcore-control` CLI not available — use boto3: `boto3.client('bedrock-agentcore-control', region_name='us-west-2').delete_memory(memoryId='...')`. Wait for ACTIVE state, delete, then `cdk destroy` → if DELETE_FAILED use `--retain-resources` |
| `bedrock-agentcore:GetWorkloadAccessToken` unauthorized | Gateway service role needs this permission to fetch OAuth tokens for outbound MCP server calls | Add `bedrock-agentcore:GetWorkloadAccessToken` on `workload-identity-directory/*` to Gateway role |
| `bedrock-agentcore:GetResourceOauth2Token` unauthorized | Gateway OAuth flow has two steps: `GetWorkloadAccessToken` then `GetResourceOauth2Token`. Both permissions required on `workload-identity-directory/*` and `token-vault/*` resources | Add both actions to Gateway role, plus `secretsmanager:GetSecretValue` for reading OAuth client secret |
| Memory "not active" for data plane (CreateEvent/ListEvents) | Memory has `strategies: []` (empty). A strategy is required for full data plane operations | Add `MemoryStrategy.usingBuiltInSummarization()` to `memoryStrategies` in memory construct |
| Athena query fails with "no output location" or wrong bucket | Athena primary workgroup has no result location configured or enforcement is off | Run `aws athena update-work-group --work-group primary --configuration-updates "ResultConfigurationUpdates={OutputLocation=s3://acme-telemetry-data-${ACCOUNT}-us-west-2/athena-results/},EnforceWorkGroupConfiguration=true"` |
| `AccessDenied: rds-data:ExecuteStatement` | MySQL MCP runtime role missing Data API permissions | Verify `additionalPolicies` in mcp-server-construct.ts includes `rds-data:*` actions targeting Aurora cluster ARN |
| `AccessDenied: secretsmanager:GetSecretValue` on Aurora secret | MySQL MCP runtime can't read Aurora credentials | Verify `additionalPolicies` includes `secretsmanager:GetSecretValue` targeting Aurora secret ARN |
| `BadRequestException: HttpEndpoint is not enabled` | RDS Data API not enabled on Aurora cluster | Verify `enableDataApi: true` in aurora-construct.ts |
| Agent doesn't see MySQL/new MCP tools | Gateway `tools/list` paginates at 30. `list_tools_sync()` only fetches page 1 | Add pagination loop with `pagination_token` in `strands_claude.py`, or pass MCPClient directly to Agent constructor |
| Aurora DB seeding `DatabaseNotFoundException` | Custom Resource Lambda fires before Aurora writer instance is ready | Add `auroraInit.node.addDependency(this.cluster)` in aurora-construct.ts |
| Athena returns 0 rows for recent Firehose data | New S3 partitions not discovered by Glue | Enable partition projection on Glue table (see `data-lake-stack.ts`) or run `MSCK REPAIR TABLE` |
| Agent uses simulated/fake data instead of Athena | Dataproc MCP role lacks `s3:ListAllMyBuckets` and agent guesses wrong output bucket | Ensure `EnforceWorkGroupConfiguration=true` on Athena `primary` workgroup (see Batch Data Generation section) |
| Agent chart renders as broken image / 10-byte file | Agent code includes `plt.savefig()`/`plt.close()` which closes figure before wrapper captures it | `strands_claude.py` strips these calls via regex before execution; system prompt also instructs agent not to include them |
| Docker build fails: `"/README.md": not found` on MCP server images | `pyproject.toml` declares `readme = "README.md"` and Dockerfile has `COPY pyproject.toml README.md .` — both require README.md in the build context | Each MCP server directory (`aws-documentation-mcp-server/`, `aws-dataprocessing-mcp-server/`) must have a `README.md` file, even a stub |
| GatewayTarget fails with `JSON keyword $defs is not supported` | mcp ≥ 1.10.0 adds `outputSchema` to Tool wire format; `$defs` appears when tools return `List[Model]` types (Pydantic v2) | Pin `mcp[cli]>=1.9.0,<1.10.0` in **pyproject.toml** — Dockerfile-only pip pin is overridden when `uv pip install .` runs. Note: mcp < 1.8.0 lacks `stateless_http` support |
| `AWS::Kinesis::Stream 'acme-telemetry-stream' already exists` | Orphaned stream from prior incomplete deploy | `aws kinesis delete-stream --stream-name acme-telemetry-stream --region us-west-2` then redeploy |

## Security / Vulnerability Baseline

| Package | Remaining vulns | Reason unfixable |
|---------|----------------|-----------------|
| `agent-stack/frontend/acme-chat` | 11 (8 high, 3 moderate) | Locked in `react-scripts` transitive deps; `npm audit fix --force` installs `react-scripts@0.0.0` (broken) |
| `agent-stack/cdk` | 2 high (minimatch ReDoS) | `aws-cdk-lib` bundles `minimatch` in its own `node_modules`; npm overrides don't reach it; upstream CDK issue |
| `data-stack/consolidated-data-stack` | 2 high (same) | Same upstream CDK minimatch issue |
| Python deps (all) | 0 | pip-audit clean |

Run security audit: `npm audit` in each Node package dir; `source .venv/bin/activate && pip install pip-audit -q && pip-audit` for Python.

**Note:** npm overrides (`"overrides": {"minimatch": "^10.2.4"}`) do NOT fix deps bundled inside `aws-cdk-lib/node_modules/` — only the top-level resolution is affected.

## E2E Browser Testing (Playwright MCP)

Use Playwright MCP tools to test the live app end-to-end:
1. Navigate to CloudFront URL (from `FrontendUrl` stack output)
2. Fill `Email/Username` + `Password` fields (`user1@test.com` / `Abcd1234@`), click `Sign In`
3. Send chat messages and wait for responses: `wait_for time=30` (Athena/MySQL), `time=45` (AWS docs)
4. First Athena query after deploy takes ~3.5 min (partition projection scans ~62K virtual partitions)
