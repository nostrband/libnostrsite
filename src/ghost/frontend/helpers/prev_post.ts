// ### prevNext helper exposes methods for prev_post and next_post - separately defined in helpers index.
//  Example usages
// `{{#prev_post}}<a href ="{{url}}>previous post</a>{{/prev_post}}'
// `{{#next_post}}<a href ="{{url absolute="true">next post</a>{{/next_post}}'
// const {hbs} = require('../services/handlebars');
// const {checks} = require('../services/data');
import { isPost } from "../utils/checks";

// @ts-ignore
import tpl from "@tryghost/tpl";
import get from "lodash-es/get";
import { getRenderer } from "../services/renderer";
import { Post } from "../../../nostrsite/types/post";
// const moment = require('moment');

const messages = {
  mustBeCalledAsBlock:
    "The {\\{{helperName}}} helper must be called as a block. E.g. {{#{helperName}}}...{{/{helperName}}}",
};

const buildApiOptions = function buildApiOptions(options: any, post: any) {
  const apiOptions = {
    type: "posts",
    limit: 2,
    filter: "id:-" + post.id,
    // context: {member: options.data.member}
  };

  if (get(options, "hash.in")) {
    if (options.hash.in === "primary_tag" && get(post, "primary_tag.slug")) {
      apiOptions.filter += "+primary_tag:" + post.primary_tag.slug;
    } else if (
      options.hash.in === "primary_author" &&
      get(post, "primary_author.slug")
    ) {
      apiOptions.filter += "+primary_author:" + post.primary_author.slug;
    } else if (options.hash.in === "author" && get(post, "author.slug")) {
      apiOptions.filter += "+author:" + post.author.slug;
    }
  }

  return apiOptions;
};

/**
 * @param {*} options
 * @param {*} data
 * @returns {Promise<any>}
 */
const fetch = async function fetch(store: any, options: any, data: any) {
  // @ts-ignore
  const self: any = this;
  const apiOptions = buildApiOptions(options, self);

  const publishedAt = self.event.created_at;
  const prev = options.name === "prev_post";

  try {
    const response = await store.list(apiOptions);

    let related: Post | undefined;
    if (prev) {
      related = response.posts
        .filter((p: Post) => p.event.created_at < publishedAt)
        .sort((a: Post, b: Post) => a.event.created_at - b.event.created_at)
        .pop();
    } else {
      related = response.posts
        .filter((p: Post) => p.event.created_at > publishedAt)
        .sort((a: Post, b: Post) => a.event.created_at - b.event.created_at)
        .shift();
    }

    if (related) {
      return options.fn(related, { data: data });
    } else {
      return options.inverse(self, { data: data });
    }
  } catch (error: any) {
    console.error(error);
    data.error = error.message;
    return options.inverse(self, { data: data });
  }
};

// If prevNext method is called without valid post data then we must return a promise, if there is valid post data
// then the promise is handled in the api call.

/**
 * @param {*} options
 * @returns {Promise<any>}
 */
export default async function prevNext(options: any) {
  options = options || {};

  const { hbs, store } = getRenderer(options);

  const createFrame = hbs.handlebars.createFrame;

  // @ts-ignore
  const self: any = this;
  const data = createFrame(options.data);
  const context = options.data.root.context;

  // Guard against incorrect usage of the helpers
  if (!options.fn || !options.inverse) {
    data.error = tpl(messages.mustBeCalledAsBlock, {
      helperName: options.name,
    });
    console.warn(data.error);
    return;
  }

  if (context.includes("preview")) {
    return options.inverse(self, { data: data });
  }

  // Guard against trying to execute prev/next on pages, or other resources
  if (!isPost(self) || self.page) {
    return options.inverse(self, { data: data });
  }

  // With the guards out of the way, attempt to build the apiOptions, and then fetch the data
  return fetch.call(self, store, options, data);
}

prevNext.async = true;
