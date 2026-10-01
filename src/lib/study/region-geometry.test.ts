import { describe, expect, it } from 'vitest';
import { regionCoordinates } from './region-geometry';
import { selectionSchema } from './contracts';
describe('scanner persistence boundary', () => {
 it('keeps resized region payload valid when the editor carries selection metadata', () => {
  const editor = { page: 1, role: 'illustration' as const, x: 0.03, y: 0.05, width: 0.92, height: 0.6, selected: true, clientId: 'question', regionIndex: 1, index: 0 };
  const updated = { ...regionCoordinates(editor), height: 0.61 };
  expect(selectionSchema.safeParse({ notebookId: 'book', questions: [{ clientId: 'question', regions: [{ page: 0, role: 'question', x: 0, y: 0, width: 1, height: 0.8 }, updated] }] }).success).toBe(true);
  expect(updated).not.toHaveProperty('selected');
  expect(updated).not.toHaveProperty('clientId');
 });
});
