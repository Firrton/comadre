/**
 * Singleton Solana JSON-RPC `Connection`.
 *
 * Reads `env.SOLANA_RPC_URL` lazily on first use so importing this module is
 * cheap and doesn't trigger any HTTP calls. Tests can call `resetConnection()`
 * to switch RPC endpoints between cases.
 */
import { Connection } from "@solana/web3.js";
import { env } from "@comadre/config";

let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (_connection !== null) return _connection;
  _connection = new Connection(env.SOLANA_RPC_URL, {
    commitment: "confirmed",
    wsEndpoint: env.SOLANA_WS_URL,
  });
  return _connection;
}

export function resetConnection(): void {
  _connection = null;
}
