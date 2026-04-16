import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { rippling } from "./rippling";
import type { SourceAdapter } from "./types";

export const sources: Record<string, SourceAdapter> = {
  ashby,
  greenhouse,
  lever,
  rippling,
};

export type SourceName = keyof typeof sources;
export type { RawPosting, SearchOpts, SourceAdapter } from "./types";
