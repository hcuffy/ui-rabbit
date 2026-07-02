import { AppMapSchema, type AppMap } from "@ui-rabbit/shared";
import type { Collection, Db } from "mongodb";

type AppMapDoc = Omit<AppMap, "id"> & { _id: string };

function toDoc(appMap: AppMap): AppMapDoc {
  const { id, ...rest } = appMap;
  return { _id: id, ...rest };
}

function fromDoc(doc: AppMapDoc): AppMap {
  const { _id, ...rest } = doc;
  return AppMapSchema.parse({ id: _id, ...rest });
}

/** backend-spec §3 — signature is literally `get()/upsert()`, no scoping param:
 * MVP is single-target (rabbit), one AppMap document total. */
export class AppMapRepo {
  private readonly collection: Collection<AppMapDoc>;

  constructor(db: Db) {
    this.collection = db.collection<AppMapDoc>("appMap");
  }

  async get(): Promise<AppMap | null> {
    const doc = await this.collection.findOne({});
    return doc ? fromDoc(doc) : null;
  }

  async upsert(appMap: AppMap): Promise<void> {
    const doc = toDoc(AppMapSchema.parse(appMap));
    await this.collection.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }
}
