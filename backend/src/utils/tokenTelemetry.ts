export interface TokenUsageRecord {
  sceneId?: number;
  roundNumber?: number;
  timestamp: string;
  sections: Record<string, number>;
}

class TokenTelemetry {
  private buffer: TokenUsageRecord[] = [];
  private readonly maxSize = 500;

  record(record: TokenUsageRecord): void {
    this.buffer.push(record);
    if (this.buffer.length > this.maxSize) {
      this.buffer.splice(0, this.buffer.length - this.maxSize);
    }
  }

  latest(count: number = 10): TokenUsageRecord[] {
    const start = Math.max(0, this.buffer.length - count);
    return this.buffer.slice(start);
  }

  clear(): void {
    this.buffer = [];
  }
}

export const tokenTelemetry = new TokenTelemetry();
