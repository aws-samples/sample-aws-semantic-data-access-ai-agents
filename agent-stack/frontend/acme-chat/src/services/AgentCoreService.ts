import axios, { AxiosResponse } from 'axios';
import { config } from '../config';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface AgentResponse {
  response: string;
  sessionId: string;
  status: 'success' | 'error';
  error?: string;
}

export interface StreamingCallback {
  onChunk: (chunk: string) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: string) => void;
}

class AgentCoreService {
  private sessionId: string | null = null;

  /**
   * Generate a new session ID
   */
  private generateSessionId(): string {
    // Generate a session ID that's at least 33 characters long (AWS requirement)
    const timestamp = Date.now().toString();
    const random1 = Math.random().toString(36).substr(2, 15);
    const random2 = Math.random().toString(36).substr(2, 15);
    return `session-${timestamp}-${random1}-${random2}`;
  }

  /**
   * Get current session ID or create a new one
   */
  private getSessionId(): string {
    if (!this.sessionId) {
      this.sessionId = this.generateSessionId();
    }
    return this.sessionId;
  }

  /**
   * Reset session (start a new conversation)
   */
  resetSession(): void {
    this.sessionId = this.generateSessionId();
  }

  /**
   * Send message to AgentCore
   */
  async sendMessage(prompt: string, idToken: string): Promise<AgentResponse> {
    try {
      // URL encode the agent ARN
      const escapedAgentArn = encodeURIComponent(config.agentcore.agentArn);
      
      // Construct the URL
      const url = `${config.agentcore.endpoint}/runtimes/${escapedAgentArn}/invocations?qualifier=DEFAULT`;
      
      // Generate trace ID
      const traceId = `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Set up headers
      const headers = {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
        'X-Amzn-Trace-Id': traceId,
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': this.getSessionId(),
      };

      // Embed session metadata in the prompt to pass through AgentCore
      const metadata = {
        sid: this.getSessionId(),      // Session ID
        uid: 'admin@acmecorp.com'      // Fixed user for demo
      };
      
      // Format: [META:json]actual message
      const enrichedPrompt = `[META:${JSON.stringify(metadata)}]${prompt}`;
      
      // Make the request
      const response: AxiosResponse = await axios.post(
        url,
        { 
          prompt: enrichedPrompt,
          sessionId: this.getSessionId() // Still include for potential future use
        },
        { 
          headers,
          timeout: 300000, // 5 minutes timeout (cold start can take ~180s)
        }
      );

      // Parse response
      let responseText = '';
      if (typeof response.data === 'string') {
        responseText = response.data;
      } else if (response.data && typeof response.data === 'object') {
        // Check if this is a visualization response
        if (response.data.type === 'visualization' && response.data.message) {
          // For visualization responses, extract only the message field
          responseText = response.data.message;
        } else {
          // For other object responses, stringify as before
          responseText = JSON.stringify(response.data, null, 2);
        }
      } else {
        responseText = String(response.data);
      }

      return {
        response: responseText,
        sessionId: this.sessionId!,
        status: 'success',
      };

    } catch (error: any) {
      console.error('AgentCore request failed:', error);
      
      let errorMessage = 'Failed to communicate with AgentCore';
      
      if (error.response) {
        // HTTP error response
        errorMessage = `HTTP ${error.response.status}: ${error.response.data?.message || error.response.statusText}`;
      } else if (error.request) {
        // Network error
        errorMessage = 'Network error - unable to reach AgentCore';
      } else if (error.message) {
        errorMessage = error.message;
      }

      return {
        response: '',
        sessionId: this.sessionId!,
        status: 'error',
        error: errorMessage,
      };
    }
  }

  /**
   * Send streaming message to AgentCore with real-time response handling
   */
  async sendStreamingMessage(
    prompt: string, 
    idToken: string, 
    callbacks: StreamingCallback
  ): Promise<void> {
    try {
      // URL encode the agent ARN
      const escapedAgentArn = encodeURIComponent(config.agentcore.agentArn);
      
      // Construct the URL - Use the streaming entrypoint by adding a query parameter
      const url = `${config.agentcore.endpoint}/runtimes/${escapedAgentArn}/invocations?qualifier=DEFAULT&streaming=true`;
      
      // Generate trace ID
      const traceId = `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Embed session metadata in the prompt
      const metadata = {
        sid: this.getSessionId(),
        uid: 'admin@acmecorp.com'
      };
      
      const enrichedPrompt = `[META:${JSON.stringify(metadata)}]${prompt}`;

      // Make streaming request using fetch API
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
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

      // Check if response is actually streaming
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/event-stream')) {
        // Fallback to regular response handling
        const text = await response.text();
        callbacks.onChunk(text);
        callbacks.onComplete(text);
        return;
      }

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
                // Try to parse as JSON first
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  callbacks.onError(parsed.error);
                  return;
                }
                
                // Skip raw event structures - only process clean text or content
                if (parsed.event || parsed.init_event_loop || parsed.start || parsed.start_event_loop) {
                  // This is a raw event structure, skip it
                  continue;
                }
                
                // Handle different parsed data types
                let content: string;
                if (typeof parsed === 'string') {
                  // If parsed is a string, use it directly (this fixes the quote issue)
                  content = parsed;
                } else if (typeof parsed === 'object' && parsed !== null) {
                  // If it's an object, try to extract content
                  content = parsed.content || parsed.data || parsed.text || '';
                  // Skip if no meaningful content found
                  if (!content) continue;
                } else {
                  // Fallback to original data
                  content = data;
                }
                
                fullResponse += content;
                callbacks.onChunk(content);
              } catch {
                // If not JSON, treat as plain text
                if (data.trim() && data !== '""') {
                  const cleanData = data.replace(/^"|"$/g, ''); // Remove surrounding quotes
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
      console.error('Streaming request failed:', error);
      
      let errorMessage = 'Failed to establish streaming connection';
      
      if (error.name === 'AbortError') {
        errorMessage = 'Request was cancelled';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      callbacks.onError(errorMessage);
    }
  }

  /**
   * Test connection to AgentCore
   */
  async testConnection(idToken: string): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.sendMessage('Hello, please respond with a simple greeting.', idToken);
      
      if (result.status === 'success') {
        return {
          success: true,
          message: 'Successfully connected to AgentCore',
        };
      } else {
        return {
          success: false,
          message: result.error || 'Failed to connect to AgentCore',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Connection test failed',
      };
    }
  }
}

export default new AgentCoreService();