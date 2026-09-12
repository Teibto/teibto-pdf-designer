/**
 * Resolve synthetic sample data without changing the identity of real records.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { DEFAULT_RECORD_TYPE } from '../constants/record-types';

export function resolveSampleRecordType(templateType: unknown, contextType: unknown): string {
  const nonempty = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  return nonempty(templateType) || nonempty(contextType) || DEFAULT_RECORD_TYPE;
}
