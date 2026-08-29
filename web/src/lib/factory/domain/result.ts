// Result monad — DIP: parsers return Result, callers depend on abstraction
// SRP: only success/failure handling, no parsing logic


export type ParseIssue = {
  path: string; // json path or file+line
  message: string;
  code: string;
};

export class ParseResult<T> {
  public readonly ok: boolean;
  public readonly value?: T;
  public readonly issues: ParseIssue[];
  private constructor(ok: boolean, value?: T, issues: ParseIssue[] = []) {
    this.ok = ok;
    this.value = value;
    this.issues = issues;
  }

  static ok<T>(value: T): ParseResult<T> {
    return new ParseResult<T>(true, value, []);
  }

  static fail<T>(issues: ParseIssue[]): ParseResult<T> {
    return new ParseResult<T>(false, undefined, issues);
  }

  static singleFail<T>(path: string, message: string, code = "validation_error"): ParseResult<T> {
    return ParseResult.fail<T>([{ path, message, code }]);
  }

  map<U>(fn: (v: T) => U): ParseResult<U> {
    if (!this.ok || this.value === undefined) return ParseResult.fail<U>(this.issues);
    try {
      return ParseResult.ok(fn(this.value));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return ParseResult.singleFail<U>("map", msg, "map_error");
    }
  }

  flatMap<U>(fn: (v: T) => ParseResult<U>): ParseResult<U> {
    if (!this.ok || this.value === undefined) return ParseResult.fail<U>(this.issues);
    return fn(this.value);
  }

  getOrThrow(): T {
    if (this.ok && this.value !== undefined) return this.value;
    throw new Error(`Parse failed: ${this.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  }
}

export function combineResults<T>(results: ParseResult<T>[]): ParseResult<T[]> {
  const issues = results.flatMap((r) => (r.ok ? [] : r.issues));
  if (issues.length > 0) {
    return ParseResult.fail(issues);
  }
  return ParseResult.ok(results.map((r) => r.value as T));
}
