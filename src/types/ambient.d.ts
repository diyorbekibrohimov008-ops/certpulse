declare module "@vercel/blob" {
  export interface PutBlobResult {
    url: string;
    downloadUrl: string;
    pathname: string;
    contentType: string;
    contentDisposition: string;
  }

  export interface PutOptions {
    access: "public" | "private";
    allowOverwrite?: boolean;
    addRandomSuffix?: boolean;
    contentType?: string;
    cacheControlMaxAge?: number;
    token?: string;
  }

  export interface GetBlobResult {
    statusCode: number;
    stream: ReadableStream<Uint8Array> | null;
    headers: Headers;
    blob: {
      url: string;
      downloadUrl: string;
      pathname: string;
      contentType: string;
      size: number;
      uploadedAt: Date;
    };
  }

  export interface GetOptions {
    access: "public" | "private";
    useCache?: boolean;
    ifNoneMatch?: string;
    token?: string;
  }

  export interface ListBlobResultBlob {
    url: string;
    downloadUrl: string;
    pathname: string;
    size: number;
    uploadedAt: Date;
  }

  export interface ListBlobResult {
    blobs: ListBlobResultBlob[];
    cursor?: string;
    hasMore: boolean;
  }

  export function put(
    pathname: string,
    body: string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream<Uint8Array>,
    options: PutOptions
  ): Promise<PutBlobResult>;

  export function get(
    pathname: string,
    options: GetOptions
  ): Promise<GetBlobResult | null>;

  export function del(
    urlOrPathname: string | string[],
    options?: { token?: string }
  ): Promise<void>;

  export function list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    token?: string;
  }): Promise<ListBlobResult>;
}

interface NodeBufferConstructor {
  from(data: ArrayBuffer | ArrayBufferView | string, encoding?: string): Uint8Array & {
    toString(encoding?: string): string;
    slice(start?: number, end?: number): Uint8Array;
  };
  concat(list: Uint8Array[]): Uint8Array;
}

declare var Buffer: NodeBufferConstructor;

interface NodeProcessEnv {
  [key: string]: string | undefined;
}

interface NodeProcess {
  env: NodeProcessEnv;
  cwd(): string;
}

declare var process: NodeProcess;

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function readFile(path: string, encoding: "utf8" | "utf-8"): Promise<string>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function dirname(p: string): string;
}

declare module "node:crypto" {
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
  export function randomUUID(): string;
}

declare module "*.css";


