export type MenhirCoreErrorCode =
  | 'NON_NORMALIZED_INPUT'
  | 'UNKNOWN_KEY'
  | 'SCHEMA_VIOLATION'
  | 'TAG_TOO_LONG'
  | 'INVALID_HEX';

export class MenhirCoreError extends Error {
  readonly code: MenhirCoreErrorCode;

  constructor(code: MenhirCoreErrorCode, message: string) {
    super(message);
    this.name = 'MenhirCoreError';
    this.code = code;
  }
}

export class NonNormalizedInputError extends MenhirCoreError {
  constructor(message = 'text is not Unicode NFC / well-formed UTF-16') {
    super('NON_NORMALIZED_INPUT', message);
    this.name = 'NonNormalizedInputError';
  }
}

export class UnknownKeyError extends MenhirCoreError {
  constructor(key: string) {
    super('UNKNOWN_KEY', `unknown top-level key: ${key}`);
    this.name = 'UnknownKeyError';
  }
}

export class SchemaViolationError extends MenhirCoreError {
  constructor(message: string) {
    super('SCHEMA_VIOLATION', message);
    this.name = 'SchemaViolationError';
  }
}

export class TagTooLongError extends MenhirCoreError {
  constructor(tag: string, byteLength: number) {
    super('TAG_TOO_LONG', `tag "${tag}" is ${byteLength} bytes (max 32)`);
    this.name = 'TagTooLongError';
  }
}

export class InvalidHexError extends MenhirCoreError {
  constructor(message: string) {
    super('INVALID_HEX', message);
    this.name = 'InvalidHexError';
  }
}
