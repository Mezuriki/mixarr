/**
 * Serializes an object for JSON, converting BigInt values to strings.
 * This is necessary because JSON.stringify() cannot handle BigInt natively.
 * 
 * @param obj - The object to serialize
 * @returns A new object with BigInt values converted to strings
 */
export function serializeForJson<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
}
