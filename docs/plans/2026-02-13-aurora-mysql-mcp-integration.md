# Aurora MySQL + MySQL MCP Server Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Aurora MySQL Serverless v2 as a new data source with an AWS Labs MySQL MCP server running on AgentCore runtime behind the existing MCP Gateway.

**Architecture:** Use the existing default VPC (`vpc-beba6ec6`) to host Aurora MySQL Serverless v2 with RDS Data API enabled — no new VPC creation needed. Deploy the AWS Labs `mysql-mcp-server` package in a Docker container on AgentCore runtime (same pattern as existing MCP servers). The MCP server connects to Aurora via Data API (IAM-authenticated, no VPC networking needed for the MCP runtime). A Lambda Custom Resource seeds the database with ACME Corp CRM data on deploy.

**Tech Stack:** AWS CDK (TypeScript), Aurora MySQL Serverless v2, RDS Data API, AWS Labs mysql-mcp-server (Python/FastMCP), AgentCore Runtime, MCP Gateway

---

## Architecture Diagram

```
Agent (Claude Haiku 4.5)
  │
  ▼
MCP Gateway (semantic search)
  │
  ├── aws-docs-mcp (existing)
  ├── dataproc-mcp (existing)
  └── mysql-mcp (NEW)
        │
        ▼ (RDS Data API - IAM auth, no VPC needed)
      Aurora MySQL Serverless v2
        │ (default VPC)
        └── Database: acme_crm
              ├── support_tickets
              └── content_ratings
```

## Database Schema: `acme_crm`

Complementary to the existing `acme_telemetry` Athena data. Provides CRM/operational data.

### Table: `support_tickets`
| Column | Type | Description |
|--------|------|-------------|
| ticket_id | VARCHAR(36) PK | UUID |
| customer_id | VARCHAR(50) | Links to telemetry customers |
| subject | VARCHAR(255) | Ticket subject line |
| description | TEXT | Full description |
| status | ENUM | open, in_progress, resolved, closed |
| priority | ENUM | low, medium, high, critical |
| category | VARCHAR(100) | billing, technical, content, account |
| agent_name | VARCHAR(100) | Support agent assigned |
| created_at | TIMESTAMP | When ticket was created |
| resolved_at | TIMESTAMP | When ticket was resolved (nullable) |

### Table: `content_ratings`
| Column | Type | Description |
|--------|------|-------------|
| rating_id | VARCHAR(36) PK | UUID |
| customer_id | VARCHAR(50) | Links to telemetry customers |
| title_id | VARCHAR(50) | Links to telemetry titles |
| rating | INT | 1-5 stars |
| review_text | TEXT | Optional review text |
| created_at | TIMESTAMP | When rating was submitted |

---

## Task 1: Create Aurora MySQL CDK Construct

**Files:**
- Create: `agent-stack/cdk/lib/constructs/aurora-construct.ts`

**Step 1: Write the Aurora construct**

Looks up the existing default VPC (`vpc-beba6ec6`) and deploys Aurora MySQL Serverless v2 with Data API enabled.

```typescript
import { Construct } from 'constructs';
import { RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Config } from '../config';

export interface AuroraConstructProps {
  readonly removalPolicy?: RemovalPolicy;
}

export class AuroraConstruct extends Construct {
  public readonly cluster: rds.DatabaseCluster;
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props?: AuroraConstructProps) {
    super(scope, id);

    const removalPolicy = props?.removalPolicy ?? RemovalPolicy.DESTROY;

    // Use existing default VPC (vpc-beba6ec6, 4 subnets across us-west-2a/b/c/d)
    this.vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // Security group - only needs internal VPC access (Data API handles external)
    const sg = new ec2.SecurityGroup(this, 'AuroraSg', {
      vpc: this.vpc,
      description: 'Aurora MySQL Serverless v2',
      allowAllOutbound: false,
    });
    sg.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(3306), 'MySQL from VPC');

    // Aurora MySQL Serverless v2 with Data API
    this.cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_08_0,
      }),
      writer: rds.ClusterInstance.serverlessV2('writer', {
        publiclyAccessible: false,
      }),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [sg],
      credentials: rds.Credentials.fromGeneratedSecret('admin', {
        secretName: 'acme-aurora-mysql-credentials',
      }),
      defaultDatabaseName: 'acme_crm',
      enableDataApi: true,
      storageEncrypted: true,
      removalPolicy,
      deletionProtection: false,
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
    });

    // Outputs
    new CfnOutput(this, 'ClusterArn', {
      value: this.cluster.clusterArn,
      description: 'Aurora Cluster ARN (for RDS Data API)',
    });

    new CfnOutput(this, 'SecretArn', {
      value: this.cluster.secret!.secretArn,
      description: 'Aurora Credentials Secret ARN',
    });

    new CfnOutput(this, 'DatabaseName', {
      value: 'acme_crm',
      description: 'Default database name',
    });
  }
}
```

**Step 2: Verify it compiles**

Run: `cd agent-stack/cdk && npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add agent-stack/cdk/lib/constructs/aurora-construct.ts
git commit -m "feat: add Aurora MySQL Serverless v2 CDK construct"
```

---

## Task 2: Create Database Seeding Lambda

**Files:**
- Create: `agent-stack/cdk/lambda/aurora-init/index.py`
- Modify: `agent-stack/cdk/lib/constructs/aurora-construct.ts` (add Custom Resource)

**Step 1: Write the Lambda seeding function**

Uses RDS Data API (no pymysql needed, no VPC needed for Lambda).

```python
"""Lambda Custom Resource to initialize Aurora MySQL with ACME CRM schema and sample data."""
import json
import boto3
import random
import uuid
from datetime import datetime, timedelta

rds_data = boto3.client('rds-data')


def execute_sql(resource_arn, secret_arn, database, sql):
    """Execute a SQL statement via RDS Data API."""
    return rds_data.execute_statement(
        resourceArn=resource_arn,
        secretArn=secret_arn,
        database=database,
        sql=sql,
    )


def handler(event, context):
    """CloudFormation Custom Resource handler."""
    request_type = event['RequestType']
    props = event['ResourceProperties']
    resource_arn = props['ClusterArn']
    secret_arn = props['SecretArn']
    database = props['DatabaseName']

    if request_type == 'Delete':
        return {'Data': {'Message': 'Delete - nothing to do'}}

    try:
        # Create tables
        execute_sql(resource_arn, secret_arn, database, """
            CREATE TABLE IF NOT EXISTS support_tickets (
                ticket_id VARCHAR(36) PRIMARY KEY,
                customer_id VARCHAR(50) NOT NULL,
                subject VARCHAR(255) NOT NULL,
                description TEXT,
                status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
                priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
                category VARCHAR(100),
                agent_name VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP NULL,
                INDEX idx_customer (customer_id),
                INDEX idx_status (status),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        execute_sql(resource_arn, secret_arn, database, """
            CREATE TABLE IF NOT EXISTS subscriptions (
                subscription_id VARCHAR(36) PRIMARY KEY,
                customer_id VARCHAR(50) NOT NULL,
                plan ENUM('free_with_ads', 'basic', 'standard', 'premium') NOT NULL,
                status ENUM('active', 'cancelled', 'expired', 'paused') DEFAULT 'active',
                start_date DATE NOT NULL,
                end_date DATE,
                monthly_amount DECIMAL(10,2) NOT NULL,
                payment_method VARCHAR(50),
                auto_renew BOOLEAN DEFAULT TRUE,
                INDEX idx_customer (customer_id),
                INDEX idx_plan (plan),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        execute_sql(resource_arn, secret_arn, database, """
            CREATE TABLE IF NOT EXISTS content_ratings (
                rating_id VARCHAR(36) PRIMARY KEY,
                customer_id VARCHAR(50) NOT NULL,
                title_id VARCHAR(50) NOT NULL,
                rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
                review_text TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_customer (customer_id),
                INDEX idx_title (title_id),
                INDEX idx_rating (rating)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        # Seed sample data using batch inserts via Data API
        # Generate ~200 support tickets, ~300 subscriptions, ~500 ratings
        _seed_support_tickets(resource_arn, secret_arn, database)
        _seed_subscriptions(resource_arn, secret_arn, database)
        _seed_content_ratings(resource_arn, secret_arn, database)

        return {'Data': {'Message': 'Database initialized successfully'}}

    except Exception as e:
        print(f"Error initializing database: {e}")
        raise


def _seed_support_tickets(resource_arn, secret_arn, database):
    """Seed support_tickets table with sample data."""
    categories = ['billing', 'technical', 'content', 'account']
    priorities = ['low', 'medium', 'high', 'critical']
    statuses = ['open', 'in_progress', 'resolved', 'closed']
    agents = ['Alice Chen', 'Bob Martinez', 'Carol Williams', 'David Kim', 'Eva Johnson']
    subjects = [
        'Cannot play video on mobile', 'Billing charge incorrect', 'App crashes on startup',
        'Cannot find downloaded content', 'Subtitle sync issue', 'Payment method declined',
        'Stream quality drops frequently', 'Account locked out', 'Cancel subscription request',
        'Feature request: offline mode', 'Audio out of sync', 'Login issues on smart TV',
        'Buffering on 4K content', 'Promo code not working', 'Content not available in region',
    ]

    random.seed(42)
    values = []
    for i in range(200):
        tid = str(uuid.UUID(int=random.getrandbits(128)))
        cid = f"CUST_{random.randint(1, 1000):06d}"
        subj = random.choice(subjects)
        status = random.choice(statuses)
        priority = random.choice(priorities)
        category = random.choice(categories)
        agent = random.choice(agents)
        created = datetime(2026, 1, 1) + timedelta(days=random.randint(0, 42), hours=random.randint(0, 23))
        resolved = (created + timedelta(hours=random.randint(1, 72))) if status in ('resolved', 'closed') else None
        resolved_str = f"'{resolved.strftime('%Y-%m-%d %H:%M:%S')}'" if resolved else "NULL"

        values.append(
            f"('{tid}', '{cid}', '{subj}', 'Customer reported: {subj.lower()}', "
            f"'{status}', '{priority}', '{category}', '{agent}', "
            f"'{created.strftime('%Y-%m-%d %H:%M:%S')}', {resolved_str})"
        )

    # Insert in batches of 50 (Data API has limits)
    for batch_start in range(0, len(values), 50):
        batch = values[batch_start:batch_start + 50]
        sql = f"INSERT IGNORE INTO support_tickets (ticket_id, customer_id, subject, description, status, priority, category, agent_name, created_at, resolved_at) VALUES {', '.join(batch)}"
        execute_sql(resource_arn, secret_arn, database, sql)


def _seed_subscriptions(resource_arn, secret_arn, database):
    """Seed subscriptions table with sample data."""
    plans = {'free_with_ads': 0.00, 'basic': 6.99, 'standard': 12.99, 'premium': 19.99}
    payment_methods = ['credit_card', 'debit_card', 'paypal', 'apple_pay', 'google_pay']
    statuses = ['active', 'active', 'active', 'cancelled', 'expired', 'paused']  # weighted toward active

    random.seed(43)
    values = []
    for i in range(300):
        sid = str(uuid.UUID(int=random.getrandbits(128)))
        cid = f"CUST_{random.randint(1, 1000):06d}"
        plan = random.choice(list(plans.keys()))
        status = random.choice(statuses)
        start = datetime(2024, 1, 1) + timedelta(days=random.randint(0, 730))
        end = (start + timedelta(days=random.randint(30, 365))) if status in ('cancelled', 'expired') else None
        end_str = f"'{end.strftime('%Y-%m-%d')}'" if end else "NULL"
        amount = plans[plan]
        payment = random.choice(payment_methods)
        auto_renew = 1 if status == 'active' and plan != 'free_with_ads' else 0

        values.append(
            f"('{sid}', '{cid}', '{plan}', '{status}', "
            f"'{start.strftime('%Y-%m-%d')}', {end_str}, {amount}, "
            f"'{payment}', {auto_renew})"
        )

    for batch_start in range(0, len(values), 50):
        batch = values[batch_start:batch_start + 50]
        sql = f"INSERT IGNORE INTO subscriptions (subscription_id, customer_id, plan, status, start_date, end_date, monthly_amount, payment_method, auto_renew) VALUES {', '.join(batch)}"
        execute_sql(resource_arn, secret_arn, database, sql)


def _seed_content_ratings(resource_arn, secret_arn, database):
    """Seed content_ratings table with sample data."""
    reviews = [
        'Great movie, loved it!', 'Not bad, decent watch.', 'Amazing cinematography.',
        'Boring plot, would not recommend.', 'Best series this year!', 'Average at best.',
        'My kids loved it.', 'A masterpiece.', 'Too long and slow.', 'Highly recommend!',
        '', '', '', '',  # many ratings have no review text
    ]

    random.seed(44)
    values = []
    for i in range(500):
        rid = str(uuid.UUID(int=random.getrandbits(128)))
        cid = f"CUST_{random.randint(1, 1000):06d}"
        tid = f"TITLE_{random.randint(1, 500):06d}"
        rating = random.choices([1, 2, 3, 4, 5], weights=[5, 10, 25, 35, 25])[0]
        review = random.choice(reviews).replace("'", "''")
        created = datetime(2025, 6, 1) + timedelta(days=random.randint(0, 250), hours=random.randint(0, 23))
        review_str = f"'{review}'" if review else "NULL"

        values.append(
            f"('{rid}', '{cid}', '{tid}', {rating}, {review_str}, "
            f"'{created.strftime('%Y-%m-%d %H:%M:%S')}')"
        )

    for batch_start in range(0, len(values), 50):
        batch = values[batch_start:batch_start + 50]
        sql = f"INSERT IGNORE INTO content_ratings (rating_id, customer_id, title_id, rating, review_text, created_at) VALUES {', '.join(batch)}"
        execute_sql(resource_arn, secret_arn, database, sql)
```

**Step 2: Add Custom Resource to Aurora construct**

Append to `aurora-construct.ts` - add a Lambda Custom Resource that runs after the cluster is created:

```typescript
// Add imports at top:
import { Duration, CustomResource } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';

// Add after cluster creation in constructor:

    // Database initialization Lambda (uses Data API - no VPC needed)
    const initFn = new lambda.Function(this, 'AuroraInitFn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/aurora-init')),
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: {
        AWS_REGION_NAME: Config.aws.region,
      },
    });

    // Grant Data API and Secrets Manager access
    initFn.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['rds-data:ExecuteStatement', 'rds-data:BatchExecuteStatement'],
      resources: [this.cluster.clusterArn],
    }));
    this.cluster.secret!.grantRead(initFn);

    const initProvider = new cr.Provider(this, 'AuroraInitProvider', {
      onEventHandler: initFn,
    });

    new CustomResource(this, 'AuroraInit', {
      serviceToken: initProvider.serviceToken,
      properties: {
        ClusterArn: this.cluster.clusterArn,
        SecretArn: this.cluster.secret!.secretArn,
        DatabaseName: 'acme_crm',
        Version: '1', // Bump to re-run seeding
      },
    });
```

**Step 3: Verify it compiles**

Run: `cd agent-stack/cdk && npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add agent-stack/cdk/lambda/aurora-init/index.py agent-stack/cdk/lib/constructs/aurora-construct.ts
git commit -m "feat: add Aurora database seeding via Lambda Custom Resource"
```

---

## Task 3: Create MySQL MCP Server Docker Image

**Files:**
- Create: `agent-stack/aws-mcp-server-agentcore/aws-mysql-mcp-server/Dockerfile`
- Create: `agent-stack/aws-mcp-server-agentcore/aws-mysql-mcp-server/docker-healthcheck.sh`

**Step 1: Write the Dockerfile**

Follows the exact same pattern as existing MCP servers. Installs the AWS Labs `mysql-mcp-server` from PyPI and creates a wrapper script for AgentCore HTTP mode.

```dockerfile
# AWS MySQL MCP Server for AgentCore Runtime
# Uses the AWS Labs mysql-mcp-server package with RDS Data API

FROM public.ecr.aws/docker/library/python:3.13-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Install the AWS Labs mysql-mcp-server package
RUN uv venv /app/.venv && \
    . /app/.venv/bin/activate && \
    uv pip install --compile-bytecode "awslabs.mysql-mcp-server" "mcp[cli]>=1.11.0"

# Runtime stage
FROM public.ecr.aws/docker/library/python:3.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends procps && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -g 1000 app && \
    useradd -u 1000 -g app -s /bin/sh -m app

WORKDIR /app

# Copy virtual environment
COPY --from=builder --chown=app:app /app/.venv /app/.venv

# Copy health check
COPY --chown=app:app docker-healthcheck.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-healthcheck.sh

# Create AgentCore wrapper script
RUN cat > /app/start_server.py << 'WRAPPER_EOF'
#!/usr/bin/env python3
"""
AgentCore wrapper for AWS MySQL MCP Server.
Configures for stateless HTTP mode and passes RDS Data API connection params.
"""
import os
import sys

os.environ.setdefault('FASTMCP_LOG_LEVEL', 'INFO')

def main():
    # Build CLI args from environment variables
    sys.argv = ['awslabs.mysql-mcp-server']

    resource_arn = os.environ.get('MYSQL_RESOURCE_ARN', '')
    secret_arn = os.environ.get('MYSQL_SECRET_ARN', '')
    database = os.environ.get('MYSQL_DATABASE', 'acme_crm')
    region = os.environ.get('AWS_REGION', 'us-west-2')
    readonly = os.environ.get('MYSQL_READONLY', 'True')

    if resource_arn:
        sys.argv.extend(['--resource_arn', resource_arn])
    if secret_arn:
        sys.argv.extend(['--secret_arn', secret_arn])
    sys.argv.extend(['--database', database])
    sys.argv.extend(['--region', region])
    sys.argv.extend(['--readonly', readonly])

    # Import the server module - it creates the FastMCP instance in main()
    from awslabs.mysql_mcp_server import server as mysql_server

    # Try to get or create the mcp instance
    if hasattr(mysql_server, 'mcp') and mysql_server.mcp is not None:
        mcp = mysql_server.mcp
    elif hasattr(mysql_server, 'create_server'):
        mcp = mysql_server.create_server()
    elif hasattr(mysql_server, 'app'):
        mcp = mysql_server.app
    else:
        # Fallback: call main() but intercept to get mcp
        # Parse args first to set up connection, then find mcp
        import importlib
        mod = importlib.import_module('awslabs.mysql_mcp_server.server')
        for attr_name in dir(mod):
            attr = getattr(mod, attr_name)
            if hasattr(attr, 'settings') and hasattr(attr, 'run'):
                mcp = attr
                break
        else:
            raise RuntimeError("Could not find FastMCP instance in mysql_mcp_server")

    # Configure for AgentCore HTTP mode
    mcp.settings.host = '0.0.0.0'
    mcp.settings.port = 8000
    mcp.settings.stateless_http = True

    if hasattr(mcp, '_transport_security'):
        mcp._transport_security = None
    if hasattr(mcp.settings, 'transport_security'):
        mcp.settings.transport_security = None

    print(f"Starting MySQL MCP Server (Data API mode)", file=sys.stderr)
    print(f"Resource ARN: {resource_arn}", file=sys.stderr)
    print(f"Database: {database}, Region: {region}", file=sys.stderr)
    print(f"Binding to 0.0.0.0:8000/mcp in stateless HTTP mode", file=sys.stderr)

    mcp.run(transport='streamable-http')

if __name__ == '__main__':
    main()
WRAPPER_EOF

RUN chmod +x /app/start_server.py && chown app:app /app/start_server.py

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

USER app

HEALTHCHECK --interval=60s --timeout=10s --start-period=10s --retries=3 \
    CMD ["docker-healthcheck.sh"]

EXPOSE 8000

ENTRYPOINT ["python", "/app/start_server.py"]
```

**Step 2: Write the healthcheck script**

```bash
#!/bin/sh
SERVER="mysql-mcp-server"

# Check if the server process is running
if pgrep -f "start_server.py" > /dev/null 2>&1; then
  echo -n "$SERVER is running";
  exit 0;
fi;

# Unhealthy
exit 1;
```

**Step 3: Test Docker build locally**

Run: `cd agent-stack/aws-mcp-server-agentcore/aws-mysql-mcp-server && docker build --platform linux/arm64 -t mysql-mcp-test .`
Expected: Build completes successfully

**Step 4: Commit**

```bash
git add agent-stack/aws-mcp-server-agentcore/aws-mysql-mcp-server/
git commit -m "feat: add MySQL MCP server Docker image for AgentCore"
```

---

## Task 4: Add MySQL MCP Server to CDK Config and Construct

**Files:**
- Modify: `agent-stack/cdk/lib/config/index.ts`
- Modify: `agent-stack/cdk/lib/constructs/mcp-server-construct.ts`

**Step 1: Add MySQL config**

In `config/index.ts`, add to the `mcpServers` object:

```typescript
  mysql: {
    name: 'mysql_mcp',
    dockerPath: '../aws-mcp-server-agentcore/aws-mysql-mcp-server',
  },
```

**Step 2: Add MySQL MCP server to the mcpServers array in mcp-server-construct.ts**

The construct needs to accept Aurora cluster ARN and secret ARN as props so it can pass them as environment variables. Update the `McpServerConstructProps` interface and add the MySQL server entry:

```typescript
// Add to McpServerConstructProps:
  readonly auroraClusterArn?: string;
  readonly auroraSecretArn?: string;
  readonly auroraDatabaseName?: string;
```

Add the MySQL MCP server to the `mcpServers` array inside the constructor.

**IAM permissions required for RDS Data API access from AgentCore runtime:**
- `rds-data:ExecuteStatement` — run individual SQL statements
- `rds-data:BatchExecuteStatement` — run batched SQL statements
- `rds-data:BeginTransaction` / `CommitTransaction` / `RollbackTransaction` — transaction support
- `secretsmanager:GetSecretValue` — read Aurora credentials (Data API authenticates via Secrets Manager)

All `rds-data:*` actions must target the Aurora cluster ARN specifically. The `secretsmanager:GetSecretValue` must target the auto-generated Aurora credentials secret ARN.

```typescript
      // Add after the dataProcessing entry:
      ...(props.auroraClusterArn ? [{
        name: Config.mcpServers.mysql.name,
        dockerPath: Config.mcpServers.mysql.dockerPath,
        description: 'MySQL MCP server for Aurora MySQL (CRM data)',
        environmentVariables: {
          MYSQL_RESOURCE_ARN: props.auroraClusterArn,
          MYSQL_SECRET_ARN: props.auroraSecretArn!,
          MYSQL_DATABASE: props.auroraDatabaseName ?? 'acme_crm',
          MYSQL_READONLY: 'True',
        },
        additionalPolicies: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              'rds-data:ExecuteStatement',
              'rds-data:BatchExecuteStatement',
              'rds-data:BeginTransaction',
              'rds-data:CommitTransaction',
              'rds-data:RollbackTransaction',
            ],
            resources: [props.auroraClusterArn],
          }),
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['secretsmanager:GetSecretValue'],
            resources: [props.auroraSecretArn!],
          }),
        ],
      }] : []),
```

**Step 3: Verify IAM policy in synthesized template**

After compiling, verify the CloudFormation template includes the correct IAM policies for the MySQL MCP server runtime role:

Run: `cd agent-stack/cdk && npx cdk synth AcmeAgentCoreStack 2>/dev/null | grep -A 30 'rds-data'`

Expected: Output shows `rds-data:ExecuteStatement`, `rds-data:BatchExecuteStatement`, `rds-data:BeginTransaction`, `rds-data:CommitTransaction`, `rds-data:RollbackTransaction` in a policy attached to the MySQL MCP runtime role, with the Aurora cluster ARN as the resource.

Also verify Secrets Manager access:

Run: `cd agent-stack/cdk && npx cdk synth AcmeAgentCoreStack 2>/dev/null | grep -B 5 -A 10 'secretsmanager:GetSecretValue'`

Expected: Output shows `secretsmanager:GetSecretValue` targeting the Aurora credentials secret ARN (not `*`).

**Step 4: Verify it compiles**

Run: `cd agent-stack/cdk && npm run build`
Expected: No TypeScript errors

**Step 5: Commit**

```bash
git add agent-stack/cdk/lib/config/index.ts agent-stack/cdk/lib/constructs/mcp-server-construct.ts
git commit -m "feat: register MySQL MCP server in CDK config and construct with Data API IAM policies"
```

---

## Task 5: Wire Aurora + MySQL MCP into Main Stack

**Files:**
- Modify: `agent-stack/cdk/lib/acme-stack.ts`

**Step 1: Import and instantiate Aurora construct**

Add import:
```typescript
import { AuroraConstruct } from './constructs/aurora-construct';
```

Add after the Memory section (before MCP Servers):
```typescript
    // ========================================
    // 3b. Aurora MySQL Database
    // ========================================
    const aurora = new AuroraConstruct(this, 'Aurora', {
      removalPolicy,
    });
```

**Step 2: Pass Aurora props to McpServerConstruct**

Update the McpServerConstruct instantiation to include Aurora references:

```typescript
    const mcpServers = new McpServerConstruct(this, 'McpServers', {
      userPool: auth.userPool,
      mcpClient: auth.mcpClient,
      mcpCredentials: secrets.mcpCredentials,
      auroraClusterArn: aurora.cluster.clusterArn,
      auroraSecretArn: aurora.cluster.secret!.secretArn,
      auroraDatabaseName: 'acme_crm',
      removalPolicy,
    });
```

**Step 3: Verify it compiles**

Run: `cd agent-stack/cdk && npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add agent-stack/cdk/lib/acme-stack.ts
git commit -m "feat: wire Aurora MySQL and MySQL MCP into main stack"
```

---

## Task 6: Update Agent System Prompt

**Files:**
- Modify: `agent-stack/cdk/docker/agent/strands_claude.py`

**Step 1: Add MySQL database schema to system prompt**

In `get_system_prompt()`, add after the Athena "Query guidelines" section:

```python
ACME CRM DATA (Aurora MySQL via MySQL MCP tools):
The acme_crm Aurora MySQL database contains ACME Corp's CRM and operational data. Use the MySQL MCP tools to query this data.

Database: acme_crm
Tables:
1. support_tickets
   Key columns: ticket_id, customer_id, subject, description,
   status (open|in_progress|resolved|closed), priority (low|medium|high|critical),
   category (billing|technical|content|account), agent_name, created_at, resolved_at

2. content_ratings
   Key columns: rating_id, customer_id, title_id, rating (1-5), review_text, created_at

MySQL query guidelines:
- Use the MySQL MCP tools (prefixed with mysql-mcp__ in gateway) to query this data
- These tables complement the Athena telemetry data - customer_id and title_id can be used to correlate
- Use standard MySQL syntax (not Athena/Presto syntax)
- Default to read-only SELECT queries
```

**Step 2: Commit**

```bash
git add agent-stack/cdk/docker/agent/strands_claude.py
git commit -m "feat: add MySQL CRM schema to agent system prompt"
```

---

## Task 7: Update CLAUDE.md Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update architecture diagram, key files, and Athena schema sections**

Add Aurora MySQL to the architecture diagram, add new key files, document the CRM schema, and update the common errors table if needed.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Aurora MySQL and MySQL MCP to CLAUDE.md"
```

---

## Task 8: Deploy and Verify

**Step 1: Build frontend (required before CDK deploy)**

Run: `cd agent-stack/frontend/acme-chat && npm run build`

**Step 2: Deploy the updated agent stack**

Run: `cd agent-stack/cdk && cdk deploy AcmeAgentCoreStack --require-approval never`

Expected: Stack deploys with new resources:
- Security group in default VPC
- Aurora MySQL Serverless v2 cluster
- Lambda (database initialization)
- MySQL MCP server runtime
- Gateway target for mysql-mcp

**Step 3: Verify Aurora is seeded**

```bash
# Get cluster and secret ARNs from CloudFormation outputs
CLUSTER_ARN=$(aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack \
  --query 'Stacks[0].Outputs[?contains(OutputKey,`ClusterArn`)].OutputValue' --output text --region us-west-2)
SECRET_ARN=$(aws cloudformation describe-stacks --stack-name AcmeAgentCoreStack \
  --query 'Stacks[0].Outputs[?contains(OutputKey,`SecretArn`)].OutputValue' --output text --region us-west-2)

# Test query via Data API
aws rds-data execute-statement \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" \
  --database acme_crm \
  --sql "SELECT COUNT(*) as cnt FROM support_tickets" \
  --region us-west-2
```

Expected: `cnt = 200`

**Step 4: Verify MySQL MCP server runtime IAM role has correct permissions**

After deploy, inspect the IAM role attached to the MySQL MCP runtime to confirm it has the Data API and Secrets Manager permissions:

```bash
# Find the MySQL MCP runtime role name from CloudFormation
MYSQL_ROLE=$(aws cloudformation describe-stack-resources --stack-name AcmeAgentCoreStack \
  --region us-west-2 --query "StackResources[?ResourceType=='AWS::IAM::Role' && contains(LogicalResourceId, 'mysqlmcp') || contains(LogicalResourceId, 'MysqlMcp') || contains(LogicalResourceId, 'mysql_mcp')].PhysicalResourceId" \
  --output text)

# If the above doesn't find it, list all roles and filter
if [ -z "$MYSQL_ROLE" ]; then
  MYSQL_ROLE=$(aws cloudformation describe-stack-resources --stack-name AcmeAgentCoreStack \
    --region us-west-2 --output json | python3 -c "
import json,sys
resources = json.load(sys.stdin)['StackResources']
for r in resources:
    if r['ResourceType'] == 'AWS::IAM::Role' and 'mysql' in r['LogicalResourceId'].lower():
        print(r['PhysicalResourceId'])
        break
")
fi

echo "MySQL MCP Role: $MYSQL_ROLE"

# List inline policies on the role
aws iam list-role-policies --role-name "$MYSQL_ROLE" --output table

# List attached managed policies
aws iam list-attached-role-policies --role-name "$MYSQL_ROLE" --output table

# Check inline policy details - look for rds-data and secretsmanager permissions
for POLICY_NAME in $(aws iam list-role-policies --role-name "$MYSQL_ROLE" --output text --query 'PolicyNames[]'); do
  echo "=== Policy: $POLICY_NAME ==="
  aws iam get-role-policy --role-name "$MYSQL_ROLE" --policy-name "$POLICY_NAME" --output json | python3 -c "
import json,sys
doc = json.load(sys.stdin)['PolicyDocument']
for stmt in doc.get('Statement', []):
    actions = stmt.get('Action', [])
    if isinstance(actions, str): actions = [actions]
    for a in actions:
        if 'rds-data' in a or 'secretsmanager' in a:
            print(f\"  Action: {a}\")
            print(f\"  Resource: {stmt.get('Resource', 'N/A')}\")
            print()
"
done
```

Expected: The role has policies containing:
- `rds-data:ExecuteStatement`, `rds-data:BatchExecuteStatement`, `rds-data:BeginTransaction`, `rds-data:CommitTransaction`, `rds-data:RollbackTransaction` → targeting the Aurora cluster ARN
- `secretsmanager:GetSecretValue` → targeting the Aurora credentials secret ARN

**If permissions are missing:** Check that `additionalPolicies` in the MySQL MCP entry in `mcp-server-construct.ts` are being applied via `runtime.addToRolePolicy()` (the `createMcpServer` method loops over `config.additionalPolicies`).

**Step 5: Verify MySQL MCP server is running**

```bash
aws logs tail /aws/bedrock-agentcore/runtimes/mysql_mcp* --region us-west-2 --since 10m --format short
```

Expected: Logs show "Starting MySQL MCP Server (Data API mode)"

**Step 6: Verify MCP server can actually call Data API (check for IAM errors in logs)**

```bash
# Check for any access denied or authorization errors in MySQL MCP logs
aws logs tail /aws/bedrock-agentcore/runtimes/mysql_mcp* --region us-west-2 --since 30m --format short 2>&1 | grep -iE 'AccessDenied|not authorized|UnauthorizedAccess|forbidden|credential|permission'
```

Expected: **No output** (no IAM errors). If you see `AccessDeniedException` or `is not authorized to perform: rds-data:ExecuteStatement`, the runtime role is missing the Data API policy.

**Common IAM errors and fixes:**

| Error | Cause | Fix |
|-------|-------|-----|
| `AccessDenied: rds-data:ExecuteStatement` | Runtime role missing Data API policy | Verify `additionalPolicies` includes `rds-data:*` actions targeting cluster ARN |
| `AccessDenied: secretsmanager:GetSecretValue` | Runtime role can't read Aurora credentials | Verify `additionalPolicies` includes `secretsmanager:GetSecretValue` targeting secret ARN |
| `BadRequestException: HttpEndpoint is not enabled` | Data API not enabled on Aurora cluster | Verify `enableDataApi: true` in aurora-construct.ts |
| `BadRequestException: Invalid resource ARN` | Wrong cluster ARN passed to MCP server | Check `MYSQL_RESOURCE_ARN` env var matches CloudFormation output |

**Step 7: Test end-to-end via the chatbot**

Open the frontend URL and ask: "How many open support tickets do we have?"

Expected: Agent routes query through gateway to MySQL MCP, returns ticket count.

If the agent fails, check logs for the specific error:
```bash
# Agent runtime logs
aws logs tail /aws/bedrock-agentcore/runtimes/acme_chatbot* --region us-west-2 --since 10m --format short 2>&1 | grep -v 'otel-rt-logs' | grep -iE 'ERROR|mysql|rds-data|denied'
# MySQL MCP logs
aws logs tail /aws/bedrock-agentcore/runtimes/mysql_mcp* --region us-west-2 --since 10m --format short 2>&1 | grep -iE 'ERROR|denied|Exception'
```

**Step 8: Commit final verification**

```bash
git add -A && git commit -m "feat: Aurora MySQL + MySQL MCP integration complete"
```

---

## Summary

| Component | What | Where |
|-----------|------|-------|
| Aurora MySQL Serverless v2 | Database cluster (default VPC) | `aurora-construct.ts` |
| Database seeding | Lambda Custom Resource | `lambda/aurora-init/index.py` |
| MySQL MCP Server | Docker on AgentCore | `aws-mysql-mcp-server/` |
| CDK config | Server registration | `config/index.ts` |
| CDK construct | Runtime + IAM policies | `mcp-server-construct.ts` |
| Main stack wiring | Aurora → MCP → Gateway | `acme-stack.ts` |
| Agent prompt | CRM schema reference | `strands_claude.py` |
| Documentation | Architecture updates | `CLAUDE.md` |

**Key design decisions:**
- **RDS Data API** instead of direct MySQL connection = no VPC needed for MCP runtime
- **Default VPC** reuse = no new VPC infrastructure, zero extra networking cost
- **Same CDK construct pattern** = MySQL MCP auto-registers with Gateway
- **Scoped IAM policies** = Data API + Secrets Manager permissions target specific Aurora ARNs (not `*`)
- **Complementary CRM dataset** = agent can correlate streaming telemetry with support/billing data

**IAM permissions checklist for MySQL MCP runtime:**
- [ ] `rds-data:ExecuteStatement` on Aurora cluster ARN
- [ ] `rds-data:BatchExecuteStatement` on Aurora cluster ARN
- [ ] `rds-data:BeginTransaction` on Aurora cluster ARN
- [ ] `rds-data:CommitTransaction` on Aurora cluster ARN
- [ ] `rds-data:RollbackTransaction` on Aurora cluster ARN
- [ ] `secretsmanager:GetSecretValue` on Aurora credentials secret ARN
- [ ] `logs:CreateLogGroup/CreateLogStream/PutLogEvents` on runtime log group (auto-added by construct)
