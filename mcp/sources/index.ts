import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import type { SourceAdapter } from "./types";

export const sources: Record<string, SourceAdapter> = {
  ashby,
  greenhouse,
  lever,
};

export type SourceName = keyof typeof sources;
export type { RawPosting, SearchOpts, SourceAdapter } from "./types";
