import { RunSchema, type Run } from "@ui-rabbit/shared";
import type { Collection, Db } from "mongodb";
import { z } from "zod";

type RunDoc = Omit<Run, "id"> & { _id: string };

const RunPatchSchema = RunSchema.omit({ id: true, charter: true, targetBaseUrl: true, startedAt: true }).partial();
export type RunPatch = z.infer<typeof RunPatchSchema>;

function toDoc(run: Run): RunDoc {
  const { id, ...rest } = run;
  return { _id: id, ...rest };
}

function fromDoc(doc: RunDoc): Run {
  const { _id, ...rest } = doc;
  return RunSchema.parse({ id: _id, ...rest });
}

/** backend-spec §3 — _id is the schema's own uuid (§2 [CONFIRM] id mapping). */
export class RunRepo {
  private readonly collection: Collection<RunDoc>;

  constructor(db: Db) {
    this.collection = db.collection<RunDoc>("runs");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ status: 1, startedAt: -1 });
  }

  async create(run: Run): Promise<void> {
    await this.collection.insertOne(toDoc(RunSchema.parse(run)));
  }

  async get(id: string): Promise<Run | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc ? fromDoc(doc) : null;
  }

  async list(): Promise<Run[]> {
    const docs = await this.collection.find().sort({ startedAt: -1 }).toArray();
    return docs.map(fromDoc);
  }

  async updateStatus(id: string, patch: RunPatch): Promise<void> {
    const parsed = RunPatchSchema.parse(patch);
    await this.collection.updateOne({ _id: id }, { $set: parsed });
  }
}
