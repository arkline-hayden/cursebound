export type NumericErrorCode = 'INVALID' | 'DIV_ZERO' | 'RANGE';

/** Error raised by every @cursebound/numeric operation on invalid input or unrepresentable requests. */
export class NumericError extends Error {
  readonly code: NumericErrorCode;
  constructor(code: NumericErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'NumericError';
    this.code = code;
  }
}
