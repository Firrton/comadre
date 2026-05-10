/**
 * Comadre Mobile — useTandas, useTanda, and mutation hooks.
 *
 * Fetches the authenticated user's tanda list from `GET /api/v1/tandas`
 * and provides mutations for create, join, contribute, and start.
 * Registers mock data when USE_MOCK is true.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, mockRegistry } from "../api/client";
import { USE_MOCK } from "../lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Individual tanda shape returned by GET /api/v1/tandas (list endpoint) */
export interface Tanda {
  id: string;
  creator: string;
  name: string;
  state: "forming" | "active" | "completed" | "paused";
  member_target: number;
  member_current: number;
  contribution_amount: string; // micro-USDC (e.g. "50000000")
  current_turn: number;
  total_turns: number;
}

/** Member shape from GET /api/v1/tandas/:id */
export interface MemberData {
  wallet: string;
  turn_number: number;
  contributions_made: number;
  has_received_payout: boolean;
  is_active: boolean;
}

/** Full tanda detail returned by GET /api/v1/tandas/:id */
export interface TandaDetail extends Tanda {
  stake_amount: string;
  next_payout_ts: number | null;
  members: MemberData[];
}

/** Paginated tanda list response */
interface TandaListResponse {
  tandas: Tanda[];
  total: number;
}

/** Response shape for mutation endpoints (create, join, contribute, start) */
export interface TandaMutationResponse {
  unsigned_tx: string;
  idempotency_key?: string;
  id?: string;
}

// ---------------------------------------------------------------------------
// Mock data (automatically registered)
// ---------------------------------------------------------------------------

const MOCK_TANDAS: Tanda[] = [
  {
    id: "tanda-1",
    creator: "wallet-1",
    name: "Tanda Viernes",
    state: "active",
    member_target: 5,
    member_current: 4,
    contribution_amount: "50000000",
    current_turn: 2,
    total_turns: 5,
  },
  {
    id: "tanda-2",
    creator: "wallet-1",
    name: "Ahorro Mensual",
    state: "forming",
    member_target: 10,
    member_current: 7,
    contribution_amount: "100000000",
    current_turn: 0,
    total_turns: 10,
  },
  {
    id: "tanda-3",
    creator: "wallet-2",
    name: "Vacaciones 2026",
    state: "active",
    member_target: 6,
    member_current: 6,
    contribution_amount: "200000000",
    current_turn: 4,
    total_turns: 6,
  },
];

/** Mock full detail data for tanda-1 (list + members) */
const MOCK_TANDA_DETAILS: Record<string, TandaDetail> = {
  "tanda-1": {
    id: "tanda-1",
    creator: "wallet-1",
    name: "Tanda Viernes",
    state: "active",
    member_target: 5,
    member_current: 4,
    contribution_amount: "50000000",
    stake_amount: "50000000",
    current_turn: 2,
    total_turns: 5,
    next_payout_ts: Math.floor(Date.now() / 1000) + 86400,
    members: [
      {
        wallet: "7yLR...64bS",
        turn_number: 1,
        contributions_made: 2,
        has_received_payout: true,
        is_active: true,
      },
      {
        wallet: "3xK9...a2fD",
        turn_number: 2,
        contributions_made: 2,
        has_received_payout: true,
        is_active: true,
      },
      {
        wallet: "9mN2...c7hJ",
        turn_number: 3,
        contributions_made: 1,
        has_received_payout: false,
        is_active: true,
      },
      {
        wallet: "5pR8...e1wL",
        turn_number: 4,
        contributions_made: 1,
        has_received_payout: false,
        is_active: true,
      },
    ],
  },
  "tanda-2": {
    id: "tanda-2",
    creator: "wallet-1",
    name: "Ahorro Mensual",
    state: "forming",
    member_target: 10,
    member_current: 7,
    contribution_amount: "100000000",
    stake_amount: "100000000",
    current_turn: 0,
    total_turns: 10,
    next_payout_ts: null,
    members: [
      {
        wallet: "7yLR...64bS",
        turn_number: 1,
        contributions_made: 0,
        has_received_payout: false,
        is_active: true,
      },
      {
        wallet: "3xK9...a2fD",
        turn_number: 2,
        contributions_made: 0,
        has_received_payout: false,
        is_active: true,
      },
      {
        wallet: "2wP6...f8mK",
        turn_number: 3,
        contributions_made: 0,
        has_received_payout: false,
        is_active: true,
      },
      {
        wallet: "1qR4...d3nJ",
        turn_number: 4,
        contributions_made: 0,
        has_received_payout: false,
        is_active: true,
      },
      {
        wallet: "8hT7...g5vB",
        turn_number: 5,
        contributions_made: 0,
        has_received_payout: false,
        is_active: true,
      },
      {
        wallet: "4kL2...m9cX",
        turn_number: 6,
        contributions_made: 0,
        has_received_payout: false,
        is_active: true,
      },
      {
        wallet: "6zY9...w1pQ",
        turn_number: 7,
        contributions_made: 0,
        has_received_payout: false,
        is_active: true,
      },
    ],
  },
  "tanda-3": {
    id: "tanda-3",
    creator: "wallet-2",
    name: "Vacaciones 2026",
    state: "active",
    member_target: 6,
    member_current: 6,
    contribution_amount: "200000000",
    stake_amount: "200000000",
    current_turn: 4,
    total_turns: 6,
    next_payout_ts: Math.floor(Date.now() / 1000) + 43200,
    members: [
      {
        wallet: "7yLR...64bS",
        turn_number: 4,
        contributions_made: 3,
        has_received_payout: false,
        is_active: true,
      },
      {
        wallet: "3xK9...a2fD",
        turn_number: 1,
        contributions_made: 4,
        has_received_payout: true,
        is_active: true,
      },
      {
        wallet: "9mN2...c7hJ",
        turn_number: 2,
        contributions_made: 4,
        has_received_payout: true,
        is_active: true,
      },
      {
        wallet: "5pR8...e1wL",
        turn_number: 3,
        contributions_made: 4,
        has_received_payout: true,
        is_active: true,
      },
      {
        wallet: "1qR4...d3nJ",
        turn_number: 5,
        contributions_made: 3,
        has_received_payout: false,
        is_active: true,
      },
      {
        wallet: "8hT7...g5vB",
        turn_number: 6,
        contributions_made: 3,
        has_received_payout: false,
        is_active: true,
      },
    ],
  },
};

if (USE_MOCK) {
  // List endpoint
  mockRegistry.set("GET:/api/v1/tandas", async (_body, params) => {
    const limit = Number(params?.limit ?? 20);
    const offset = Number(params?.offset ?? 0);
    const slice = MOCK_TANDAS.slice(offset, offset + limit);
    return { tandas: slice, total: MOCK_TANDAS.length } satisfies TandaListResponse;
  });

  // Detail + mutation endpoints — register for each known ID
  const KNOWN_IDS = ["tanda-1", "tanda-2", "tanda-3"];

  for (const id of KNOWN_IDS) {
    // Detail
    const detail = MOCK_TANDA_DETAILS[id];
    if (detail) {
      mockRegistry.set(`GET:/api/v1/tandas/${id}`, async () => detail satisfies TandaDetail);
    }

    // Join
    mockRegistry.set(`POST:/api/v1/tandas/${id}/join`, async () => {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
      return { unsigned_tx: "mock-tx-base64" } satisfies TandaMutationResponse;
    });

    // Contribute
    mockRegistry.set(`POST:/api/v1/tandas/${id}/contribute`, async () => {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
      return { unsigned_tx: "mock-tx-base64" } satisfies TandaMutationResponse;
    });

    // Start
    mockRegistry.set(`POST:/api/v1/tandas/${id}/start`, async () => {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
      return { unsigned_tx: "mock-tx-base64" } satisfies TandaMutationResponse;
    });
  }

  // Create tanda (no ID in path)
  mockRegistry.set("POST:/api/v1/tandas", async () => {
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    return {
      id: "new-tanda-uuid",
      unsigned_tx: "mock-tx-base64",
      idempotency_key: "mock-key",
    } satisfies TandaMutationResponse;
  });
}

// ---------------------------------------------------------------------------
// Hooks — Queries
// ---------------------------------------------------------------------------

/**
 * Fetch the authenticated user's tanda list.
 *
 * @param limit  Page size (default 20)
 * @param offset Pagination offset (default 0)
 * @returns      React Query result with `tandas`, `isLoading`, `error`, `refetch`
 */
export function useTandas(limit = 20, offset = 0) {
  const query = useQuery<TandaListResponse>({
    queryKey: ["tandas", { limit, offset }],
    queryFn: () =>
      get<TandaListResponse>("/api/v1/tandas", {
        params: {
          limit: String(limit),
          offset: String(offset),
        },
      }),
  });

  return {
    tandas: query.data?.tandas ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Fetch a single tanda's full detail including members.
 *
 * In mock mode, resolves known IDs via MOCK_TANDA_DETAILS; unknown IDs
 * throw NOT_FOUND (caught by the API client's mock guard). In real mode,
 * uses GET /api/v1/tandas/:id.
 */
export function useTanda(id: string | undefined) {
  const query = useQuery<TandaDetail>({
    queryKey: ["tandas", id],
    queryFn: () => get<TandaDetail>(`/api/v1/tandas/${id}`),
    enabled: !!id,
  });

  return {
    tanda: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

// ---------------------------------------------------------------------------
// Hooks — Mutations
// ---------------------------------------------------------------------------

/**
 * Create a new tanda.
 *
 * POST /api/v1/tandas
 * Invalidates the tandas query on success so the list refreshes.
 */
export function useCreateTanda() {
  const queryClient = useQueryClient();

  return useMutation<TandaMutationResponse, Error, Record<string, unknown>>({
    mutationFn: (data) =>
      post<TandaMutationResponse>("/api/v1/tandas", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tandas"] });
    },
  });
}

/**
 * Join a tanda.
 *
 * POST /api/v1/tandas/:id/join
 * Invalidates the specific tanda detail query on success.
 */
export function useJoinTanda() {
  const queryClient = useQueryClient();

  return useMutation<
    TandaMutationResponse,
    Error,
    { tandaId: string; payload?: Record<string, unknown> }
  >({
    mutationFn: ({ tandaId, payload }) =>
      post<TandaMutationResponse>(`/api/v1/tandas/${tandaId}/join`, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tandas", variables.tandaId] });
      queryClient.invalidateQueries({ queryKey: ["tandas", { limit: 20, offset: 0 }] });
    },
  });
}

/**
 * Contribute to the current turn of a tanda.
 *
 * POST /api/v1/tandas/:id/contribute
 * Invalidates the specific tanda detail query on success.
 */
export function useContribute() {
  const queryClient = useQueryClient();

  return useMutation<
    TandaMutationResponse,
    Error,
    { tandaId: string; payload?: Record<string, unknown> }
  >({
    mutationFn: ({ tandaId, payload }) =>
      post<TandaMutationResponse>(
        `/api/v1/tandas/${tandaId}/contribute`,
        payload,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tandas", variables.tandaId] });
    },
  });
}

/**
 * Start a tanda (creator only).
 *
 * POST /api/v1/tandas/:id/start
 * Invalidates the specific tanda detail query on success.
 */
export function useStartTanda() {
  const queryClient = useQueryClient();

  return useMutation<
    TandaMutationResponse,
    Error,
    { tandaId: string; payload?: Record<string, unknown> }
  >({
    mutationFn: ({ tandaId, payload }) =>
      post<TandaMutationResponse>(`/api/v1/tandas/${tandaId}/start`, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tandas", variables.tandaId] });
      queryClient.invalidateQueries({ queryKey: ["tandas", { limit: 20, offset: 0 }] });
    },
  });
}
