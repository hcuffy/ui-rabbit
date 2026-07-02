import { BaselineSchema, type Baseline } from "@ui-rabbit/shared";
import type { Collection, Db } from "mongodb";

type BaselineDoc = Omit<Baseline, "screenId"> & { _id: string };

function toDoc(baseline: Baseline): BaselineDoc {
  const { screenId, ...rest } = baseline;
  return { _id: screenId, ...rest };
}

function fromDoc(doc: BaselineDoc): Baseline {
  const { _id, ...rest } = doc;
  return BaselineSchema.parse({ screenId: _id, ...rest });
}

/** backend-spec §3. _id is `screenId` (§2 [CONFIRM] id mapping) — one per screen,
 * already uniquely indexed via _id, so no separate `screenId` index is needed. */
export class BaselineRepo {
  private readonly collection: Collection<BaselineDoc>;

  constructor(db: Db) {
    this.collection = db.collection<BaselineDoc>("baselines");
  }

  async getByScreenIds(screenIds: string[]): Promise<Baseline[]> {
    if (screenIds.length === 0) return [];
    const docs = await this.collection.find({ _id: { $in: screenIds } }).toArray();
    return docs.map(fromDoc);
  }

  async upsert(baseline: Baseline): Promise<void> {
    const doc = toDoc(BaselineSchema.parse(baseline));
    await this.collection.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }
}
