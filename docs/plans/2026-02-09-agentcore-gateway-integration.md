# AgentCore Gateway Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route all agent-to-MCP-server traffic through a single Bedrock AgentCore Gateway, replacing direct MCP client connections.

**Architecture:** Create an AgentCore Gateway with MCP protocol that sits between the main agent runtime and the two MCP servers (AWS Docs, Data Processing). The Gateway handles tool discovery (semantic search), authentication routing, and provides a unified MCP endpoint. MCP servers keep Cognito OAuth auth — the Gateway authenticates to them via an OAuth2 credential provider in the Token Vault (client_credentials flow). The agent connects to one Gateway URL instead of managing multiple MCP clients.

**Tech Stack:** AWS CDK (`@aws-cdk/aws-bedrock-agentcore-alpha` v2.235.0), Gateway construct, Python Strands SDK, MCP `streamablehttp_client`

---

## Current vs Target Architecture

```
CURRENT:
  Agent Runtime ──(OAuth bearer)──▶ aws_docs_mcp Runtime
  Agent Runtime ──(OAuth bearer)──▶ dataproc_mcp Runtime

TARGET:
  Agent Runtime ──(OAuth bearer)──▶ Gateway ──(OAuth via Token Vault)──▶ aws_docs_mcp Runtime
                                            ──(OAuth via Token Vault)──▶ dataproc_mcp Runtime
```

Key changes:
- **Inbound (Agent → Gateway):** Cognito JWT auth (reuse existing user pool + MCP client)
- **Outbound (Gateway → MCP servers):** OAuth2 via Token Vault credential provider (Cognito client_credentials flow)
- **MCP servers:** Keep Cognito OAuth auth (Gateway authenticates using Token Vault OAuth provider)
- **Agent code:** Single MCPClient to Gateway URL (replaces per-server MCPManager)

---

### Task 1: Add Gateway Configuration

**Files:**
- Modify: `agent-stack/cdk/lib/config/index.ts`

**Step 1: Add gateway config section**

Add the `gateway` key inside the `Config` object, after the `mcpServers` block:

```typescript
// In agent-stack/cdk/lib/config/index.ts, after mcpServers block (line ~59)

  // Gateway Configuration
  gateway: {
    name: 'acme_mcp_gateway',
    description: 'ACME Corp MCP Gateway for unified tool access',
    instructions: 'Use this gateway to access AWS documentation search and ACME telemetry data processing tools. Route all tool calls through this gateway.',
  },
```

**Step 2: Verify TypeScript compiles**

Run: `cd agent-stack/cdk && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add agent-stack/cdk/lib/config/index.ts
git commit -m "feat: add gateway configuration to config"
```

---

### Task 2: Keep MCP Servers on Cognito OAuth Auth

**Files:**
- No changes needed to: `agent-stack/cdk/lib/constructs/mcp-server-construct.ts`

**Why:** The Gateway authenticates to MCP servers using an OAuth2 credential provider stored in the Token Vault. MCP servers keep their existing Cognito OAuth auth. The Gateway's Token Vault provider performs the client_credentials flow to obtain bearer tokens for outbound calls.

**Note:** The original plan proposed switching MCP servers to IAM auth, but AWS AgentCore Gateway targets for MCP servers require OAuth credential providers (`GatewayCredentialProvider.fromOauthIdentityArn()`), not IAM. This was discovered during implementation.

**Step 1: No MCP server auth changes needed**

MCP servers remain on Cognito OAuth. The Gateway handles outbound auth via the Token Vault OAuth provider.

**Step 2: Commit**

No commit needed — MCP server construct unchanged.

---

### Task 3: Create Gateway Construct

**Files:**
- Create: `agent-stack/cdk/lib/constructs/gateway-construct.ts`

**Step 1: Create the gateway construct file**

```typescript
import { Construct } from 'constructs';
import { Fn, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import {
  Gateway,
  GatewayAuthorizer,
  GatewayProtocol,
  McpGatewaySearchType,
  MCPProtocolVersion,
  GatewayCredentialProvider,
  GatewayExceptionLevel,
} from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Config } from '../config';

export interface GatewayConstructProps {
  /** Existing Cognito User Pool for inbound auth */
  readonly userPool: IUserPool;
  /** MCP client for JWT validation */
  readonly mcpClient: IUserPoolClient;
  /** Map of MCP server names to their Runtime ARNs */
  readonly mcpServerArns: Record<string, string>;
  /** OAuth credential provider ARN from the Token Vault */
  readonly oauthProviderArn: string;
  /** Secrets Manager ARN for the OAuth credentials */
  readonly oauthSecretArn: string;
  readonly removalPolicy?: RemovalPolicy;
}

export class GatewayConstruct extends Construct {
  public readonly gateway: Gateway;

  constructor(scope: Construct, id: string, props: GatewayConstructProps) {
    super(scope, id);

    // Create the Gateway with MCP protocol and Cognito inbound auth
    this.gateway = new Gateway(this, 'McpGateway', {
      gatewayName: Config.gateway.name,
      description: Config.gateway.description,
      protocolConfiguration: GatewayProtocol.mcp({
        instructions: Config.gateway.instructions,
        searchType: McpGatewaySearchType.SEMANTIC,
        supportedVersions: [MCPProtocolVersion.MCP_2025_03_26],
      }),
      authorizerConfiguration: GatewayAuthorizer.usingCognito({
        userPool: props.userPool,
        allowedClients: [props.mcpClient],
      }),
      exceptionLevel: GatewayExceptionLevel.DEBUG,
    });

    // Add each MCP server as a target
    for (const [name, arn] of Object.entries(props.mcpServerArns)) {
      // Build the MCP server endpoint URL from the Runtime ARN
      // URL-encode the ARN: replace '/' with '%2F', then ':' with '%3A'
      const slashEncoded = Fn.join('%2F', Fn.split('/', arn));
      const fullyEncoded = Fn.join('%3A', Fn.split(':', slashEncoded));

      const endpointUrl = Fn.join('', [
        `https://bedrock-agentcore.${Config.aws.region}.amazonaws.com/runtimes/`,
        fullyEncoded,
        '/invocations?qualifier=DEFAULT',
      ]);

      this.gateway.addMcpServerTarget(`${name}Target`, {
        gatewayTargetName: name,
        description: `MCP target for ${name}`,
        endpoint: endpointUrl,
        credentialProviderConfigurations: [
          GatewayCredentialProvider.fromOauthIdentityArn({
            providerArn: props.oauthProviderArn,
            secretArn: props.oauthSecretArn,
            scopes: ['mcp/invoke'],
          }),
        ],
      });
    }

    // Grant the Gateway's role permission to invoke MCP server Runtimes
    this.gateway.role.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: Object.values(props.mcpServerArns).map(
          arn => arn  // ARNs are already fully-qualified
        ),
      })
    );

    // Also grant with wildcard for runtime/* pattern (deploy-time ARNs may differ)
    this.gateway.role.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [`arn:aws:bedrock-agentcore:${Config.aws.region}:*:runtime/*`],
      })
    );

    // Outputs
    new CfnOutput(this, 'GatewayArn', {
      value: this.gateway.gatewayArn,
      description: 'ACME MCP Gateway ARN',
      exportName: 'AcmeMcpGatewayArn',
    });

    new CfnOutput(this, 'GatewayId', {
      value: this.gateway.gatewayId,
      description: 'ACME MCP Gateway ID',
      exportName: 'AcmeMcpGatewayId',
    });

    if (this.gateway.gatewayUrl) {
      new CfnOutput(this, 'GatewayUrl', {
        value: this.gateway.gatewayUrl,
        description: 'ACME MCP Gateway URL',
        exportName: 'AcmeMcpGatewayUrl',
      });
    }
  }
}
```

**Step 2: Verify the imports resolve**

Run: `cd agent-stack/cdk && npx tsc --noEmit`
Expected: May have errors due to acme-stack.ts not wired yet. The gateway construct itself should compile if imports are correct. If `GatewayProtocol` import fails, try `McpProtocolConfiguration` directly:

```typescript
import { McpProtocolConfiguration, McpGatewaySearchType, MCPProtocolVersion } from '@aws-cdk/aws-bedrock-agentcore-alpha';
```

And replace `GatewayProtocol.mcp({...})` with `new McpProtocolConfiguration({...})`.

**Step 3: Commit**

```bash
git add agent-stack/cdk/lib/constructs/gateway-construct.ts
git commit -m "feat: create gateway construct with MCP server targets"
```

---

### Task 4: Wire Gateway into Main Stack

**Files:**
- Modify: `agent-stack/cdk/lib/acme-stack.ts`

**Step 1: Add import for GatewayConstruct**

```typescript
import { GatewayConstruct } from './constructs/gateway-construct';
```

**Step 2: Update McpServerConstruct instantiation**

Remove `userPool` and `mcpClient` props (they were removed in Task 2):

```typescript
// BEFORE (lines ~85-90):
const mcpServers = new McpServerConstruct(this, 'McpServers', {
  userPool: auth.userPool,
  mcpClient: auth.mcpClient,
  mcpCredentials: secrets.mcpCredentials,
  removalPolicy,
});

// AFTER:
const mcpServers = new McpServerConstruct(this, 'McpServers', {
  mcpCredentials: secrets.mcpCredentials,
  removalPolicy,
});
```

**Step 3: Add Gateway construct between McpServers and Agent**

Insert after the MCP servers section (~line 92), before the Agent section:

```typescript
    // ========================================
    // 4b. MCP Gateway
    // ========================================
    const gateway = new GatewayConstruct(this, 'Gateway', {
      userPool: auth.userPool,
      mcpClient: auth.mcpClient,
      mcpServerArns: mcpServers.getArns(),
      oauthProviderArn: oauthProvider.providerArn,
      oauthSecretArn: secrets.mcpCredentials.secretArn,
      removalPolicy,
    });
```

**Step 4: Update AgentRuntimeConstruct to receive gateway URL**

Change the `AgentRuntimeConstructProps` interface in `agent-runtime-construct.ts` to accept the gateway URL instead of (or in addition to) MCP server endpoints:

In `agent-stack/cdk/lib/constructs/agent-runtime-construct.ts`:

```typescript
// Add to AgentRuntimeConstructProps interface:
  /** Gateway URL for MCP tool access */
  readonly gatewayUrl?: string;
```

In the constructor, add the gateway URL as an environment variable:

```typescript
// In the environmentVariables block of the Runtime constructor:
...(props.gatewayUrl ? { GATEWAY_MCP_URL: props.gatewayUrl } : {}),
```

**Step 5: Pass gateway URL from acme-stack.ts**

Update the Agent constructor call to include gateway URL:

```typescript
    const agent = new AgentRuntimeConstruct(this, 'Agent', {
      userPool: auth.userPool,
      frontendClient: auth.frontendClient,
      mcpCredentials: secrets.mcpCredentials,
      memory: memory.memory,
      mcpServerEndpoints: mcpServers.getArns(),
      gatewayUrl: gateway.gateway.gatewayUrl,
      removalPolicy,
    });
```

**Step 6: Grant agent runtime invoke on gateway**

Add after the agent constructor in `acme-stack.ts`:

```typescript
    // Grant agent permission to invoke the gateway
    gateway.gateway.grantInvoke(agent.runtime);
```

**Step 7: Add gateway to deployment summary output**

Update the `DeploymentSummary` CfnOutput to include the gateway:

```typescript
    new CfnOutput(this, 'DeploymentSummary', {
      value: JSON.stringify({
        region: Config.aws.region,
        stack: Config.naming.stackName,
        frontendUrl: this.frontendUrl,
        agentArn: this.agentArn,
        userPoolId: this.userPoolId,
        mcpServers: Object.keys(mcpServers.getArns()),
        gatewayId: gateway.gateway.gatewayId,
      }, null, 2),
      description: 'Deployment summary JSON',
    });
```

**Step 8: Verify TypeScript compiles**

Run: `cd agent-stack/cdk && npx tsc --noEmit`
Expected: Clean compilation

**Step 9: Verify CDK synthesizes**

Run: `cd agent-stack/cdk && npx cdk synth 2>&1 | head -50`
Expected: CloudFormation template output (may fail if Docker not running, that's OK)

**Step 10: Commit**

```bash
git add agent-stack/cdk/lib/acme-stack.ts agent-stack/cdk/lib/constructs/agent-runtime-construct.ts
git commit -m "feat: wire gateway into main stack and agent runtime"
```

---

### Task 5: Update Agent Python Code to Use Gateway

**Files:**
- Modify: `agent-stack/cdk/docker/agent/strands_claude.py`

**Overview:** Replace the `MCPManager` class (which manages per-server MCP clients with OAuth tokens) with a simpler approach: one `MCPClient` pointing at the Gateway URL. The Gateway handles tool routing and outbound auth to MCP servers.

**Step 1: Add gateway URL env var reader**

Replace the `get_mcp_endpoints_from_env()` function with:

```python
def get_gateway_url() -> Optional[str]:
    """
    Get the MCP Gateway URL from environment variables (set by CDK).
    The Gateway provides a single MCP endpoint for all tool access.
    """
    gateway_url = os.environ.get('GATEWAY_MCP_URL')
    if gateway_url:
        print(f"Gateway MCP URL configured: {gateway_url[:80]}...")
    else:
        print("GATEWAY_MCP_URL not set - falling back to direct MCP endpoints")
    return gateway_url
```

Keep the old `get_mcp_endpoints_from_env()` function as fallback (rename to `_get_mcp_endpoints_from_env_legacy`).

**Step 2: Simplify MCPManager to prefer Gateway**

Replace the `MCPManager` class with a version that prefers the Gateway:

```python
class MCPManager:
    """Manages MCP client creation - prefers Gateway, falls back to direct"""

    def __init__(self):
        self._bearer_token: Optional[str] = None
        self._token_expires_at: float = 0
        self._credentials: Optional[Dict[str, str]] = None
        self._gateway_url: Optional[str] = None
        self._initialized: bool = False

    def _init_credentials(self) -> bool:
        """Initialize credentials and check if MCP is available"""
        if self._initialized:
            return self._gateway_url is not None

        self._initialized = True

        try:
            self._gateway_url = get_gateway_url()
            self._credentials = secrets_manager.get_mcp_credentials()

            if self._gateway_url:
                print(f"MCP Gateway mode: {self._gateway_url}")
                return True
            else:
                print("No Gateway URL configured - MCP tools unavailable")
                return False

        except Exception as e:
            print(f"Could not initialize MCP: {e}")
            return False

    def is_mcp_available(self) -> bool:
        return self._init_credentials()

    def _get_bearer_token(self) -> str:
        """Get bearer token from Cognito with caching"""
        if not self._init_credentials():
            raise Exception("MCP not available")

        current_time = time.time()
        if self._bearer_token and current_time < self._token_expires_at:
            return self._bearer_token

        try:
            pool_id = self._credentials['MCP_COGNITO_POOL_ID']
            region = self._credentials['MCP_COGNITO_REGION']
            client_id = self._credentials['MCP_COGNITO_CLIENT_ID']
            client_secret = self._credentials['MCP_COGNITO_CLIENT_SECRET']
            cognito_domain = self._credentials.get('MCP_COGNITO_DOMAIN')

            if not cognito_domain:
                raise Exception("MCP_COGNITO_DOMAIN not configured")

            token_url = f"https://{cognito_domain}/oauth2/token"
            print(f"Getting fresh MCP bearer token from {region}...")

            response = requests.post(
                token_url,
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                data={
                    'grant_type': 'client_credentials',
                    'client_id': client_id,
                    'client_secret': client_secret,
                    'scope': 'mcp/invoke'
                },
                timeout=10
            )

            if response.status_code == 200:
                token_data = response.json()
                self._bearer_token = token_data['access_token']
                self._token_expires_at = current_time + (50 * 60)
                print("MCP bearer token obtained successfully")
                return self._bearer_token
            else:
                raise Exception(f"Token request failed: {response.status_code}")

        except Exception as e:
            print(f"Failed to get MCP bearer token: {e}")
            raise

    def create_gateway_client(self) -> MCPClient:
        """Create a single MCP client for the Gateway"""
        try:
            bearer_token = self._get_bearer_token()
            headers = {
                "authorization": f"Bearer {bearer_token}",
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream"
            }

            print(f"Creating Gateway MCP client: {self._gateway_url[:80]}...")
            client = MCPClient(
                lambda: streamablehttp_client(
                    self._gateway_url,
                    headers=headers,
                    timeout=120,
                    terminate_on_close=False
                )
            )
            print("Gateway MCP client created successfully")
            return client

        except Exception as e:
            print(f"Failed to create Gateway MCP client: {e}")
            raise
```

**Step 3: Simplify `create_agent_with_memory` to use single Gateway client**

Update the MCP client section in `create_agent_with_memory()`:

```python
    # Collect MCP tools via Gateway (single client)
    mcp_clients = []

    if mcp_manager.is_mcp_available():
        try:
            mcp_clients.append(('gateway', mcp_manager.create_gateway_client()))
        except Exception as e:
            print(f"Gateway client unavailable: {e}")
    else:
        print("MCP integration not configured - agent running without MCP tools")
```

**Step 4: No changes needed to `run_with_clients` / streaming logic**

The existing `run_with_clients()` and `run_streaming_with_clients()` functions already handle a list of MCP clients generically. With the Gateway, the list will have one client instead of two. The rest of the logic (context managers, tool collection, agent creation) works unchanged.

**Step 5: Verify the Python code is syntactically valid**

Run: `cd agent-stack/cdk/docker/agent && python3 -c "import ast; ast.parse(open('strands_claude.py').read()); print('OK')"`
Expected: `OK`

**Step 6: Commit**

```bash
git add agent-stack/cdk/docker/agent/strands_claude.py
git commit -m "feat: update agent to use Gateway MCP client instead of direct connections"
```

---

### Task 6: Update CLAUDE.md and Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Step 1: Update CLAUDE.md architecture diagram**

Replace the architecture section with:

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
│  │                    │     MCP Servers (Cognito OAuth)    │            │  │
│  │                    │  ┌─────────────┐  ┌──────────────┐│            │  │
│  │                    │  │ AWS Docs    │  │ Data Process ││            │  │
│  │                    │  │ MCP Server  │  │ MCP Server   │├────────┐   │  │
│  │                    │  └─────────────┘  └──────────────┘│        │   │  │
│  │                    └───────────────────────────────────┘        │   │  │
│  └────────────────────────────────────────────────────────────────┼───┘  │
│                                                                    │      │
│                                                          Athena Queries   │
│                                                                    │      │
│  ┌─────────────────────────────────────────────────────────────────┼───┐  │
│  │                    DATA STACK (data-stack/)                     │   │  │
│  │                                                                 ▼   │  │
│  │   EventBridge ──▶ Lambda ──▶ Kinesis ──▶ Firehose ──▶ S3 Data Lake  │  │
│  │   (5 min)         (Generator)  (Stream)              (Glue + Athena)│  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Step 2: Add Gateway section to CLAUDE.md**

After the "MCP Servers" section, add:

```markdown
## MCP Gateway

The agent accesses all MCP tools through a single AgentCore Gateway (`gateway-construct.ts`):
- **Inbound auth**: Cognito JWT (same credentials as direct MCP access)
- **Outbound auth**: OAuth2 via Token Vault credential provider (Cognito client_credentials flow)
- **Protocol**: MCP with semantic search (tool discovery)
- **Tool naming**: Gateway prefixes tools with target name: `{target-name}__{tool-name}`
- Gateway URL passed to agent as `GATEWAY_MCP_URL` environment variable
```

**Step 3: Add gateway-construct.ts to Key Files table**

```markdown
| `agent-stack/cdk/lib/constructs/gateway-construct.ts` | MCP Gateway (unified tool access point) |
```

**Step 4: Update README.md architecture diagram similarly**

**Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: update architecture diagrams and docs for gateway integration"
```

---

### Task 7: CDK Synth Validation

**Files:** None (validation only)

**Step 1: Install dependencies**

Run: `cd agent-stack/cdk && npm install`

**Step 2: TypeScript compile check**

Run: `cd agent-stack/cdk && npx tsc --noEmit`
Expected: Clean compilation, no errors

**Step 3: CDK synth**

Run: `cd agent-stack/cdk && npx cdk synth 2>&1 | tail -20`
Expected: CloudFormation template generated (needs Docker for asset bundling)

If imports fail, check the exact export names from the alpha package:

```bash
cd agent-stack/cdk && node -e "
  const agentcore = require('@aws-cdk/aws-bedrock-agentcore-alpha');
  console.log('Gateway:', !!agentcore.Gateway);
  console.log('GatewayAuthorizer:', !!agentcore.GatewayAuthorizer);
  console.log('GatewayProtocol:', !!agentcore.GatewayProtocol);
  console.log('McpProtocolConfiguration:', !!agentcore.McpProtocolConfiguration);
  console.log('GatewayCredentialProvider:', !!agentcore.GatewayCredentialProvider);
  console.log('McpGatewaySearchType:', !!agentcore.McpGatewaySearchType);
  console.log('MCPProtocolVersion:', !!agentcore.MCPProtocolVersion);
  console.log('GatewayExceptionLevel:', !!agentcore.GatewayExceptionLevel);
"
```

Fix any import names that don't resolve.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve import/compile issues from gateway integration"
```

---

## Deployment Notes

After implementing all tasks, deploy with:

```bash
cd agent-stack/cdk
cdk deploy AcmeAgentCoreStack --require-approval never
```

The deploy will:
1. MCP servers keep Cognito OAuth auth (Gateway uses Token Vault OAuth provider)
2. Create the new Gateway resource
3. Add MCP server targets to Gateway
4. Update agent runtime with `GATEWAY_MCP_URL` env var
5. Rebuild and deploy the agent Docker container

## Rollback

If the Gateway doesn't work:
1. Revert `strands_claude.py` to use direct MCP endpoints (old MCPManager)
2. Revert MCP servers to Cognito auth
3. Remove GatewayConstruct from acme-stack.ts
4. Redeploy

## Risk Notes

- **MCP server OAuth auth**: MCP servers remain on Cognito OAuth. The Gateway authenticates via Token Vault OAuth provider (client_credentials flow). The agent goes through the Gateway for all tool calls.
- **Gateway URL availability**: `gateway.gatewayUrl` is a CloudFormation attribute (`Fn::GetAtt`). It should resolve at deploy time. If it's undefined at synth time, use `gateway.gatewayArn` to construct the URL.
- **Tool name prefixing**: The Gateway prefixes tool names with `{target-name}__`. MCP server code should handle this. Test that tool invocations work correctly through the Gateway.
- **CDK alpha package**: `@aws-cdk/aws-bedrock-agentcore-alpha` is experimental. API may change between versions.
