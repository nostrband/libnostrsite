import { Author } from "./author";
import { Post } from "./post";
import { Tag } from "./tag";
import { StoreObject } from "./store";
import { Pagination } from "./pagination";

export interface Context {
  context: string[];
  param?: string;
  param2?: string;
  object?: StoreObject;
  posts?: Post[];
  post?: Post;
  page?: any;
  tag?: Tag;
  author?: Author;
  pagination?: Pagination;
  mediaUrls: string[];
  hasRss?: boolean;
  allowRss?: boolean;
  path: string;
  pathBase: string;
  pathHtml: string;
}