import { Data } from "every-plugin/effect";

export class RpcError extends Data.TaggedError("RpcError")<{
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

export class ChainDataError extends Data.TaggedError("ChainDataError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class PlanNotFoundError extends Data.TaggedError("PlanNotFoundError")<{
  readonly message: string;
  readonly planId: string;
}> {}

export class SubscriptionNotFoundError extends Data.TaggedError("SubscriptionNotFoundError")<{
  readonly message: string;
  readonly planId: string;
  readonly payerRef: string;
}> {}

export class InvalidAmountError extends Data.TaggedError("InvalidAmountError")<{
  readonly message: string;
  readonly minAmount: string;
  readonly maxAmount: string;
}> {}
