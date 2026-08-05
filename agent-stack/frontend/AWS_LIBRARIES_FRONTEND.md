# AWS Libraries in Frontend - Complete Reference

## Overview

The ACME Corp AgentCore chatbot frontend maintains a minimal AWS footprint by using only essential AWS libraries for authentication while communicating with other AWS services through REST APIs and JWT tokens.

## AWS Libraries Used

### Single AWS Dependency
- **amazon-cognito-identity-js**: `v6.3.15` - The only AWS library in the frontend

### Libraries NOT Used (Intentionally)
- `aws-sdk` (v2) - Legacy AWS SDK
- `@aws-sdk/*` (v3) - Modern AWS SDK packages
- Any direct AWS service clients

## amazon-cognito-identity-js Implementation

### Installation
```json
// package.json
{
  "dependencies": {
    "amazon-cognito-identity-js": "^6.3.15"
  }
}
```

### Imports and Classes Used

```typescript
// src/services/AuthService.ts
import {
  AuthenticationDetails,    // Username/password authentication
  CognitoUser,             // Individual user operations
  CognitoUserPool,         // User pool connection
  CognitoUserSession,      // Session and token management
} from 'amazon-cognito-identity-js';
```

## Complete AuthService Implementation

### Service Configuration

```typescript
// src/services/AuthService.ts
import { config } from '../config';

class AuthService {
  private userPool: CognitoUserPool;

  constructor() {
    // Initialize Cognito User Pool connection
    this.userPool = new CognitoUserPool({
      UserPoolId: config.cognito.userPoolId,    // '<REGION>_XXXXXXXXX'
      ClientId: config.cognito.appClientId,     // '<APP_CLIENT_ID>'
    });
  }
}
```

### User Authentication Implementation

```typescript
/**
 * Sign in user with username and password
 */
signIn(username: string, password: string): Promise<User> {
  return new Promise((resolve, reject) => {
    // Create authentication details
    const authenticationDetails = new AuthenticationDetails({
      Username: username,
      Password: password,
    });

    // Create Cognito user object
    const cognitoUser = new CognitoUser({
      Username: username,
      Pool: this.userPool,
    });

    // Authenticate user
    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: (session: CognitoUserSession) => {
        // Extract JWT tokens
        const accessToken = session.getAccessToken().getJwtToken();
        const idToken = session.getIdToken().getJwtToken();
        
        // Extract user email from ID token payload
        const idTokenPayload = session.getIdToken().payload;
        const email = idTokenPayload.email || username;

        const user: User = {
          username,
          email,
          accessToken,  // Used for AgentCore API calls
          idToken,      // Contains user claims
        };

        resolve(user);
      },
      onFailure: (error) => {
        reject(new Error(error.message || 'Authentication failed'));
      },
      mfaRequired: () => {
        reject(new Error('MFA is required but not supported in this demo'));
      },
      newPasswordRequired: () => {
        reject(new Error('New password required but not supported in this demo'));
      },
    });
  });
}
```

### Session Management

```typescript
/**
 * Get current authenticated user session
 */
getCurrentUser(): Promise<User | null> {
  return new Promise((resolve, reject) => {
    const cognitoUser = this.userPool.getCurrentUser();
    
    if (!cognitoUser) {
      resolve(null);
      return;
    }

    // Validate existing session
    cognitoUser.getSession((error: Error | null, session: CognitoUserSession | null) => {
      if (error) {
        reject(error);
        return;
      }

      if (!session || !session.isValid()) {
        resolve(null);
        return;
      }

      // Extract tokens from valid session
      const accessToken = session.getAccessToken().getJwtToken();
      const idToken = session.getIdToken().getJwtToken();
      const idTokenPayload = session.getIdToken().payload;
      
      const user: User = {
        username: cognitoUser.getUsername(),
        email: idTokenPayload.email || cognitoUser.getUsername(),
        accessToken,
        idToken,
      };

      resolve(user);
    });
  });
}

/**
 * Check if user is currently authenticated
 */
isAuthenticated(): Promise<boolean> {
  return this.getCurrentUser()
    .then(user => user !== null)
    .catch(() => false);
}
```

### Sign Out Implementation

```typescript
/**
 * Sign out current user
 */
signOut(): Promise<void> {
  return new Promise((resolve) => {
    const cognitoUser = this.userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
    }
    resolve();
  });
}
```

### User Interface Definition

```typescript
// User object returned by AuthService
export interface User {
  username: string;    // Cognito username
  email: string;       // Email from ID token
  accessToken: string; // JWT access token for API calls
  idToken: string;     // JWT ID token with user claims
}
```

## AgentCore API Integration (No AWS SDK)

The frontend communicates with AWS services through AgentCore REST APIs without using AWS SDK:

### Configuration Setup

```typescript
// src/config.ts
export const config = {
  // AWS Cognito Authentication
  cognito: {
    userPoolId: '<REGION>_XXXXXXXXX',
    appClientId: '<APP_CLIENT_ID>',
    region: 'us-west-2',
    discoveryUrl: 'https://cognito-idp.us-west-2.amazonaws.com/<REGION>_XXXXXXXXX/.well-known/openid-configuration'
  },
  
  // AgentCore Backend (Direct REST API)
  agentcore: {
    agentArn: 'arn:aws:bedrock-agentcore:us-west-2:<ACCOUNT_ID>:runtime/<AGENT_RUNTIME_ID>',
    region: 'us-west-2',
    endpoint: 'https://bedrock-agentcore.us-west-2.amazonaws.com'
  }
};
```

### REST API Communication

```typescript
// src/services/AgentCoreService.ts - Regular API calls
async sendMessage(prompt: string, accessToken: string): Promise<AgentResponse> {
  try {
    // Construct AgentCore URL manually (no AWS SDK)
    const escapedAgentArn = encodeURIComponent(config.agentcore.agentArn);
    const url = `${config.agentcore.endpoint}/runtimes/${escapedAgentArn}/invocations?qualifier=DEFAULT`;
    
    // Generate AWS-compatible trace ID
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Set up AWS-compatible headers
    const headers = {
      'Authorization': `Bearer ${accessToken}`,           // Cognito JWT token
      'Content-Type': 'application/json',
      'X-Amzn-Trace-Id': traceId,                        // AWS tracing
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': this.getSessionId(), // Session management
    };

    // Embed metadata for backend processing
    const metadata = {
      sid: this.getSessionId(),      // Session ID for memory
      uid: 'admin@acmecorp.com'      // User ID for memory isolation
    };
    
    // Format: [META:json]actual message
    const enrichedPrompt = `[META:${JSON.stringify(metadata)}]${prompt}`;
    
    // Make HTTP request using Axios
    const response: AxiosResponse = await axios.post(
      url,
      { 
        prompt: enrichedPrompt,
        sessionId: this.getSessionId()
      },
      { 
        headers,
        timeout: 120000, // 2 minutes timeout
      }
    );

    return {
      response: response.data,
      sessionId: this.sessionId!,
      status: 'success',
    };

  } catch (error: any) {
    // Handle AWS-style errors without AWS SDK
    let errorMessage = 'Failed to communicate with AgentCore';
    
    if (error.response) {
      errorMessage = `HTTP ${error.response.status}: ${error.response.data?.message || error.response.statusText}`;
    } else if (error.request) {
      errorMessage = 'Network error - unable to reach AgentCore';
    }

    return {
      response: '',
      sessionId: this.sessionId!,
      status: 'error',
      error: errorMessage,
    };
  }
}
```

### Streaming API Implementation

```typescript
// Streaming communication using Fetch API (no AWS SDK)
async sendStreamingMessage(
  prompt: string, 
  accessToken: string, 
  callbacks: StreamingCallback
): Promise<void> {
  try {
    // Construct streaming URL
    const escapedAgentArn = encodeURIComponent(config.agentcore.agentArn);
    const url = `${config.agentcore.endpoint}/runtimes/${escapedAgentArn}/invocations?qualifier=DEFAULT&streaming=true`;
    
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Embed session metadata
    const metadata = {
      sid: this.getSessionId(),
      uid: 'admin@acmecorp.com'
    };
    const enrichedPrompt = `[META:${JSON.stringify(metadata)}]${prompt}`;

    // Make streaming request using Fetch API
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',                    // Server-Sent Events
        'Cache-Control': 'no-cache',
        'X-Amzn-Trace-Id': traceId,
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': this.getSessionId(),
      },
      body: JSON.stringify({
        prompt: enrichedPrompt,
        sessionId: this.getSessionId(),
        streaming: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Process Server-Sent Events stream
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    if (!reader) {
      throw new Error('Unable to read streaming response');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          callbacks.onComplete(fullResponse);
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.trim() === '') continue;
          
          // Parse Server-Sent Events format
          if (line.startsWith('data: ')) {
            const data = line.slice(6); // Remove 'data: ' prefix
            
            if (data.trim() === '[DONE]') {
              callbacks.onComplete(fullResponse);
              return;
            }

            try {
              const parsed = JSON.parse(data);
              
              // Handle streaming content
              let content: string;
              if (typeof parsed === 'string') {
                content = parsed;
              } else if (typeof parsed === 'object' && parsed !== null) {
                content = parsed.content || parsed.data || parsed.text || '';
                if (!content) continue;
              } else {
                content = data;
              }
              
              fullResponse += content;
              callbacks.onChunk(content);
            } catch {
              // If not JSON, treat as plain text
              if (data.trim() && data !== '""') {
                const cleanData = data.replace(/^"|"$/g, '');
                fullResponse += cleanData;
                callbacks.onChunk(cleanData);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

  } catch (error: any) {
    callbacks.onError(error.message || 'Failed to establish streaming connection');
  }
}
```

### Session Management (AWS Compatible)

```typescript
class AgentCoreService {
  private sessionId: string | null = null;

  /**
   * Generate AWS-compatible session ID (≥33 characters)
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString();
    const random1 = Math.random().toString(36).substr(2, 15);
    const random2 = Math.random().toString(36).substr(2, 15);
    return `session-${timestamp}-${random1}-${random2}`;
  }

  /**
   * Get current session ID or create new one
   */
  private getSessionId(): string {
    if (!this.sessionId) {
      this.sessionId = this.generateSessionId();
    }
    return this.sessionId;
  }

  /**
   * Reset session for new conversation
   */
  resetSession(): void {
    this.sessionId = this.generateSessionId();
  }
}
```

## Usage Examples

### Complete Authentication Flow

```typescript
// App.tsx - Main authentication logic
const [user, setUser] = useState<User | null>(null);

// Check existing authentication on app start
useEffect(() => {
  checkAuthStatus();
}, []);

const checkAuthStatus = async () => {
  try {
    const currentUser = await AuthService.getCurrentUser();
    setUser(currentUser); // Will be null if not authenticated
  } catch (error) {
    console.error('Authentication check failed:', error);
  }
};

const handleLogin = async (username: string, password: string) => {
  try {
    const authenticatedUser = await AuthService.signIn(username, password);
    setUser(authenticatedUser);
  } catch (error) {
    console.error('Login failed:', error);
  }
};

const handleLogout = async () => {
  try {
    await AuthService.signOut();
    setUser(null);
  } catch (error) {
    console.error('Logout failed:', error);
  }
};
```

### AgentCore API Usage

```typescript
// ChatInterface.tsx - Sending messages
const sendMessage = async (message: string) => {
  if (!user) return;
  
  try {
    // Use Cognito access token for authentication
    const response = await AgentCoreService.sendMessage(message, user.accessToken);
    
    if (response.status === 'success') {
      // Handle successful response
      addAssistantMessage(response.response);
    } else {
      // Handle API error
      console.error('AgentCore error:', response.error);
    }
  } catch (error) {
    console.error('Failed to send message:', error);
  }
};
```

## Testing Connection

```typescript
// Connection test without AWS SDK
const testConnection = async (accessToken: string): Promise<{success: boolean; message: string}> => {
  try {
    const result = await AgentCoreService.sendMessage('Hello, please respond with a simple greeting.', accessToken);
    
    return result.status === 'success' 
      ? { success: true, message: 'Successfully connected to AgentCore' }
      : { success: false, message: result.error || 'Failed to connect to AgentCore' };
  } catch (error: any) {
    return { success: false, message: error.message || 'Connection test failed' };
  }
};
```

## Summary

The frontend achieves full AWS integration using:
- **Single AWS library**: `amazon-cognito-identity-js` for authentication
- **REST API patterns**: Direct HTTP calls to AgentCore endpoints
- **JWT authentication**: Cognito tokens for all API requests
- **Manual URL construction**: No dependency on AWS SDK URL builders
- **Standard HTTP clients**: Axios and Fetch API for requests

This approach provides a secure, performant, and maintainable solution while keeping the frontend bundle size minimal and avoiding complex AWS SDK configurations.