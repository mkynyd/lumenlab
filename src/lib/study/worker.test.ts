import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findJob: vi.fn(), updateJob: vi.fn(), findItem: vi.fn(), updateItem: vi.fn(), transaction: vi.fn(), fence: vi.fn(), model: vi.fn(), solve: vi.fn(), read: vi.fn(), bank: vi.fn(), search: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { studyJob: { findFirst: mocks.findJob, updateMany: mocks.updateJob }, mistakeItem: { findFirst: mocks.findItem, update: mocks.updateItem }, bankQuestion: { findMany: mocks.bank }, $transaction: mocks.transaction } }));
vi.mock('@/lib/storage/object-storage', () => ({ readStoredObject: mocks.read }));
vi.mock('@/lib/tools/web/search-engine', () => ({ runWebSearch: mocks.search }));
vi.mock('./model-gateway', () => ({ studyModelJson: mocks.model, solveSelectedQuestion: mocks.solve }));
import { processStudyJob } from './worker';
beforeEach(() => {
 vi.clearAllMocks();
 mocks.findJob.mockResolvedValue({ id: 'job', userId: 'owner', status: 'queued', leaseOwner: null, leaseUntil: null, payload: { items: ['item'], syllabus: '' } });
 mocks.updateJob.mockResolvedValue({ count: 1 }); mocks.fence.mockResolvedValue({ count: 1 });
 mocks.findItem.mockResolvedValue({ id: 'item', status: 'queued', prompt: '', assets: [{ provider: 'local', key: 'study/selected/owner/item/0.png', role: 'question', page: 0 }] });
 mocks.read.mockResolvedValue(Buffer.from('image')); mocks.model.mockResolvedValue({ markdown: '缺少一项条件', complete: false, missing: ['题干下半段'] });
 mocks.transaction.mockImplementation(async callback => callback({ studyJob: { updateMany: mocks.fence }, mistakeItem: { update: mocks.updateItem } }));
});
describe('durable study job fencing', () => {
 it('preserves incomplete OCR as needs_review without searching or generating an answer', async () => {
  await processStudyJob();
  expect(mocks.updateItem).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'needs_review', prompt: '缺少一项条件' }) }));
  expect(mocks.solve).not.toHaveBeenCalled(); expect(mocks.search).not.toHaveBeenCalled();
 });
 it('prevents item writes after another worker has reclaimed the lease', async () => {
  mocks.fence.mockResolvedValue({ count: 0 });
  await processStudyJob();
  expect(mocks.updateItem).not.toHaveBeenCalled();
  expect(mocks.fence.mock.calls[0][0].where.leaseOwner).toEqual(expect.any(String));
 });
 it('rejects a foreign selected asset before reading or invoking a provider', async () => {
  mocks.findItem.mockResolvedValue({ id: 'item', status: 'queued', prompt: '', assets: [{ provider: 'local', key: 'study/selected/other/item/0.png', role: 'question', page: 0 }] });
  await processStudyJob();
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.model).not.toHaveBeenCalled();
  expect(mocks.findItem.mock.calls[0][0].where.notebook.collection.userId).toBe('owner');
 });
});
