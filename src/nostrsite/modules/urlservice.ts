import { getRelativeUrlPrefix } from "..";
import { Store } from "../types/store";
import { NostrSiteUrlUtils } from "./urlutils";

// stub for server/url-service
export class UrlService {
  private store: Store;
  private utils: NostrSiteUrlUtils;
  private origin: string;
  private subDir: string;

  constructor(store: Store, utils: NostrSiteUrlUtils, origin: string, subDir: string) {
    this.store = store;
    this.utils = utils;
    this.origin = origin;
    this.subDir = subDir;
  }

  public getUrlByResource(
    data: any,
    {
      absolute,
      withSubdirectory,
    }: {
      absolute?: boolean;
      withSubdirectory?: boolean;
    }
  ) {
    const prefix = getRelativeUrlPrefix(data);
    return (
      (absolute ? this.origin : "") +
      (withSubdirectory ? this.subDir : "") +
      prefix +
      (data.slug || data.id)
    );
  }

  public getUrlByResourceId(id: string, options: any = {}) {
    console.log("getUrlByResourceId resource", id);
    const slug = this.store.getUrl(id);
    if (slug) {
      if (options.absolute) {
        return this.utils.createUrl(slug, options.absolute);
      }

      if (options.withSubdirectory) {
        return this.utils.createUrl(slug, false, true);
      }

      return slug;
    }

    if (options.absolute) {
      return this.utils.createUrl("/404/", options.absolute);
    }

    if (options.withSubdirectory) {
      return this.utils.createUrl("/404/", false);
    }

    return "/404/";
  }
}