declare module "../../snowflake-connection.js" {
  export function getSnowflakeConfig(): Record<string, unknown>;
  export function connectToSnowflake(): Promise<unknown>;
  export function executeQuery(
    sql: string,
    binds?: unknown[],
  ): Promise<unknown[]>;
  export function closeConnection(): Promise<void>;
}

declare module "../../../snowflake-queries.js" {
  export function buildOpportunitiesQuery(filters?: Record<string, unknown>): string;
  export function buildOwnersQuery(): string;
  export function buildCloseMonthsQuery(): string;
  export function buildStatsQuery(): string;
}
