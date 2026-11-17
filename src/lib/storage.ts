import fs from "node:fs/promises";
import path from "node:path";

export interface StoredMediaObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface StorageAdapter {
  readonly driver: "vercel-blob" | "local-fs" | "memory";
  getJson<T>(key: string): Promise<T | null>;
  putJson<T>(key: string, value: T): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  deleteKey(key: string): Promise<void>;
  putMedia(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
  getMedia(key: string): Promise<StoredMediaObject | null>;
}

export function sanitizeStorageKey(rawKey: string): string {
  const normalized = rawKey.replace(/\\/g, "/").replace(/^\/+/, "");
  const safeParts = normalized
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  return safeParts.join("/");
}

class VercelBlobAdapter implements StorageAdapter {
  readonly driver = "vercel-blob" as const;

  private async sdk() {
    return import("@vercel/blob");
  }

  async getJson<T>(key: string): Promise<T | null> {
    const safeKey = sanitizeStorageKey(key);
    try {
      const { get } = await this.sdk();
      const result = await get(safeKey, {
        access: "private",
        useCache: false,
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        return null;
      }
      const text = await new Response(result.stream).text();
      return JSON.parse(text) as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not\s*found|404|does\s*not\s*exist/i.test(message)) {
        return null;
      }
      throw err;
    }
  }

  async putJson<T>(key: string, value: T): Promise<void> {
    const safeKey = sanitizeStorageKey(key);
    const { put } = await this.sdk();
    await put(safeKey, JSON.stringify(value, null, 2), {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
    });
  }

  async listKeys(prefix: string): Promise<string[]> {
    const safePrefix = sanitizeStorageKey(prefix);
    const { list } = await this.sdk();
    const keys: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await list({ prefix: safePrefix, cursor, limit: 100 });
      for (const blob of page.blobs) {
        keys.push(blob.pathname);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    return keys;
  }

  async deleteKey(key: string): Promise<void> {
    const safeKey = sanitizeStorageKey(key);
    const { del } = await this.sdk();
    await del(safeKey);
  }

  async putMedia(key: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const safeKey = sanitizeStorageKey(key);
    const { put } = await this.sdk();
    await put(safeKey, Buffer.from(bytes), {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType,
    });
    return safeKey;
  }

  async getMedia(key: string): Promise<StoredMediaObject | null> {
    const safeKey = sanitizeStorageKey(key);
    try {
      const { get } = await this.sdk();
      const result = await get(safeKey, {
        access: "private",
        useCache: false,
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        return null;
      }
      const buffer = await new Response(result.stream).arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        contentType: result.blob.contentType || "application/octet-stream",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not\s*found|404|does\s*not\s*exist/i.test(message)) {
        return null;
      }
      throw err;
    }
  }
}

export class LocalFileStorageAdapter implements StorageAdapter {
  readonly driver = "local-fs" as const;
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    if (rootDir) {
      this.rootDir = rootDir;
    } else if (process.env.CERTPULSE_DATA_DIR) {
      this.rootDir = process.env.CERTPULSE_DATA_DIR;
    } else if (process.env.VERCEL) {
      this.rootDir = "/tmp/certpulse-data";
    } else {
      this.rootDir = path.join(process.cwd(), ".data");
    }
  }

  private resolveSafePath(key: string): string {
    const safeKey = sanitizeStorageKey(key);
    const full = path.resolve(this.rootDir, ...safeKey.split("/"));
    const rootResolved = path.resolve(this.rootDir);
    if (!full.startsWith(rootResolved)) {
      throw new Error("Invalid storage path");
    }
    return full;
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const text = await fs.readFile(this.resolveSafePath(key), "utf8");
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async putJson<T>(key: string, value: T): Promise<void> {
    const target = this.resolveSafePath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(value, null, 2));
  }

  async listKeys(prefix: string): Promise<string[]> {
    const safePrefix = sanitizeStorageKey(prefix);
    const startDir = this.resolveSafePath(safePrefix);
    const found: string[] = [];

    const walk = async (dir: string, currentPrefix: string): Promise<void> => {
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.endsWith(".meta.json")) continue;
        const full = path.join(dir, entry);
        const relKey = currentPrefix ? `${currentPrefix}/${entry}` : entry;
        let subEntries: string[] | null = null;
        try {
          subEntries = await fs.readdir(full);
        } catch {
          subEntries = null;
        }
        if (subEntries !== null) {
          await walk(full, relKey);
        } else {
          found.push(relKey);
        }
      }
    };

    await walk(startDir, safePrefix);
    return found.sort();
  }

  async deleteKey(key: string): Promise<void> {
    await fs.rm(this.resolveSafePath(key), { force: true });
  }

  async putMedia(key: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const safeKey = sanitizeStorageKey(key);
    const target = this.resolveSafePath(safeKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    await fs.writeFile(`${target}.meta.json`, JSON.stringify({ contentType }));
    return safeKey;
  }

  async getMedia(key: string): Promise<StoredMediaObject | null> {
    const target = this.resolveSafePath(key);
    try {
      const bytes = await fs.readFile(target);
      let contentType = "application/octet-stream";
      try {
        const metaRaw = await fs.readFile(`${target}.meta.json`, "utf8");
        const parsed = JSON.parse(metaRaw) as { contentType?: string };
        if (parsed.contentType) contentType = parsed.contentType;
      } catch {
        // Default binary type when metadata sidecar absent
      }
      return { bytes, contentType };
    } catch {
      return null;
    }
  }
}

export class MemoryStorageAdapter implements StorageAdapter {
  readonly driver = "memory" as const;
  private readonly jsonStore = new Map<string, string>();
  private readonly mediaStore = new Map<string, StoredMediaObject>();

  async getJson<T>(key: string): Promise<T | null> {
    const raw = this.jsonStore.get(sanitizeStorageKey(key));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async putJson<T>(key: string, value: T): Promise<void> {
    this.jsonStore.set(sanitizeStorageKey(key), JSON.stringify(value));
  }

  async listKeys(prefix: string): Promise<string[]> {
    const safePrefix = sanitizeStorageKey(prefix);
    return [...this.jsonStore.keys()]
      .filter((k) => k.startsWith(safePrefix))
      .sort();
  }

  async deleteKey(key: string): Promise<void> {
    this.jsonStore.delete(sanitizeStorageKey(key));
  }

  async putMedia(key: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const safeKey = sanitizeStorageKey(key);
    this.mediaStore.set(safeKey, { bytes: new Uint8Array(bytes), contentType });
    return safeKey;
  }

  async getMedia(key: string): Promise<StoredMediaObject | null> {
    const item = this.mediaStore.get(sanitizeStorageKey(key));
    return item ? { bytes: new Uint8Array(item.bytes), contentType: item.contentType } : null;
  }
}

let cachedStorage: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (cachedStorage) return cachedStorage;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    cachedStorage = new VercelBlobAdapter();
  } else {
    cachedStorage = new LocalFileStorageAdapter();
  }
  return cachedStorage;
}

export function setStorageOverride(adapter: StorageAdapter | null): void {
  cachedStorage = adapter;
}
