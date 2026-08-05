import { Construct } from 'constructs';
import { Duration, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Memory, MemoryStrategy } from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { Config } from '../config';

export interface MemoryConstructProps {
  readonly removalPolicy?: RemovalPolicy;
}

export class MemoryConstruct extends Construct {
  public readonly memory: Memory;

  constructor(scope: Construct, id: string, props?: MemoryConstructProps) {
    super(scope, id);

    // Create AgentCore Memory for conversation persistence
    this.memory = new Memory(this, 'ChatMemory', {
      memoryName: Config.agent.memory.name,
      description: 'Conversation memory for ACME chatbot - stores user interactions and context',
      expirationDuration: Duration.days(Config.agent.memory.expirationDays),
      memoryStrategies: [
        MemoryStrategy.usingBuiltInSummarization(),
      ],
    });

    // Outputs
    new CfnOutput(this, 'MemoryId', {
      value: this.memory.memoryId,
      description: 'AgentCore Memory ID',
      exportName: 'AcmeMemoryId',
    });

    new CfnOutput(this, 'MemoryArn', {
      value: this.memory.memoryArn,
      description: 'AgentCore Memory ARN',
      exportName: 'AcmeMemoryArn',
    });
  }
}
