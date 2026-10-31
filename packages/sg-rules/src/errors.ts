/** Thrown when a caller passes an invalid input (bad date, negative money, unsafe integer…). */
export class SgRulesInputError extends Error {
  override readonly name = "SgRulesInputError";
}

/** Thrown when no rule version covers the requested date (outside the encoded, cited data). */
export class RulesNotAvailableError extends Error {
  override readonly name = "RulesNotAvailableError";
}
