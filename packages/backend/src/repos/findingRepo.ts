import { FindingSchema, type Finding } from "@ui-rabbit/shared";
import type { Collection, Db } from "mongodb";

type FindingDoc = Omit<Finding, "id"> & { _id: string };

function toDoc(finding: Finding): FindingDoc {
  const { id, ...rest } = finding;
  return { _id: id, ...rest };
}

function fromDoc(doc: FindingDoc): Finding {
  const { _id, ...rest } = doc;
  return FindingSchema.parse({ id: _id, ...rest });
}

/** backend-spec §3. Upserts by `dedupKey` (§2 index) so a RECURRING/RESOLVED update
 * replaces the prior doc rather than duplicating it — mirrors driver's localStore.ts. */
export class FindingRepo {
  private readonly collection: Collection<FindingDoc>;

  constructor(db: Db) {
    this.collection = db.collection<FindingDoc>("findings");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ dedupKey: 1 });
    await this.collection.createIndex({ runId: 1 });
  }

  async findByDedupKeys(keys: string[]): Promise<Finding[]> {
    if (keys.length === 0) return [];
    const docs = await this.collection.find({ dedupKey: { $in: keys } }).toArray();
    return docs.map(fromDoc);
  }

  /** Not in §3's example list — needed by the orchestrator to load the prior
   * findings scoped to the screens touched by this run (runner.ts §RESOLVED logic). */
  async findByScreenIds(screenIds: string[]): Promise<Finding[]> {
    if (screenIds.length === 0) return [];
    const docs = await this.collection.find({ screenId: { $in: screenIds } }).toArray();
    return docs.map(fromDoc);
  }

  async upsert(finding: Finding): Promise<void> {
    const doc = toDoc(FindingSchema.parse(finding));
    await this.collection.replaceOne({ dedupKey: doc.dedupKey }, doc, { upsert: true });
  }

  async listByRun(runId: string): Promise<Finding[]> {
    const docs = await this.collection.find({ runId }).toArray();
    return docs.map(fromDoc);
  }

  async get(id: string): Promise<Finding | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc ? fromDoc(doc) : null;
  }
}
