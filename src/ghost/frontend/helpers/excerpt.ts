// # Excerpt Helper
// Usage: `{{excerpt}}`, `{{excerpt words="50"}}`, `{{excerpt characters="256"}}`
//
// Attempts to remove all HTML from the string, and then shortens the result according to the provided option.
//
// Defaults to words="50"

import escape from "lodash-es/escape";
import { getRenderer } from "../services/renderer";
import reduce from "lodash-es/reduce";
import isEmpty from "lodash-es/isEmpty";
import { isAudioUrl, isVideoUrl } from "../../..";

export default function excerpt(options: any) {
  const { SafeString, metaData } = getRenderer(options);
  const getMetaDataExcerpt = metaData.getMetaDataExcerpt;

  let truncateOptions: any = (options || {}).hash || {};

  let excerptText;

  // @ts-ignore
  const self: any = this;

  if (self.custom_excerpt) {
    excerptText = String(self.custom_excerpt);
  } else if (self.excerpt) {
    excerptText = String(self.excerpt);
  } else {
    excerptText = "";
  }

  excerptText = escape(excerptText);

  truncateOptions = reduce(
    truncateOptions,
    (_truncateOptions: any, value, key) => {
      if (["words", "characters"].includes(key)) {
        _truncateOptions[key] = parseInt(value, 10);
      }
      return _truncateOptions;
    },
    {}
  );

  // For custom excerpts, make sure we truncate them only based on length
  if (!isEmpty(self.custom_excerpt)) {
    truncateOptions.characters = excerptText.length; // length is expanded by use of escaped characters
    if (truncateOptions.words) {
      delete truncateOptions.words;
    }
  }

  let html = getMetaDataExcerpt(excerptText, truncateOptions);

  if (!self.feature_image) {
    let code = "";
    for (const url of self.links) {
      if (isVideoUrl(url, self.event)) {
        code = `<span style='position: relative; display: inline-block'>
          <video src="${url}#t=0.1" preload="meta" style="max-width: 120px; max-height: 120px; border-radius: 5px; "></video>
          <img 
            style='opacity: 0.4; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);' 
            src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAACXBIWXMAAAsTAAALEwEAmpwYAAACw0lEQVR4nO2aPWtUQRSGHxXdjaIkEBMLxWCjP0D8BZIQUAxW+UALK5tgSGNrG2OhKIitCGJho66aXiSKtmbzgYWJiJ9FBDWuemTgCGG5e/funJm9F8kLLyzs3jPz7pw5c86ZCxv4f9EFDAHTQAWoAl+ANaX7PKffud+cADopCErAGDAD/AKkRbpnHgGjaqvt6AAmgbcek2/EFWACKLdLxCCwFFBAPReBgZgC3NJfiSignjd15YOiF3jRRhGifA70hBLRp8stOXFB52DCbg2jkjOXgD2+Iso5uZOkuJlXiL5egMlLHa/6hFgpKPuzinDLN1+ACUsDLmY9NCc9jH8DRoA3bRJzLstqrHgKQQ+w88BqZCHLzTb+mKfh73V29gK3gD8RxYykCZnxNPqjgb3DwJNIQipp9YRPKi5abzTCJuCUp8tKCmvArqQBhwxGf9Ic23X/fA0o5ljSQJeM/05W7AfuBNo/F5MGqBgMOpdsFUeAp0Yh95IMLxgM/sYPm4EzwDvPcatJRj8bhDg3sWAHcEHDeCvjfkgytmZc5hA4ANy1hv0iCDmkXRWTEItriZ4XvujSfkAthGtZM94tHgLcM2eBj55jzoUOvz5CXPh9FiP8ThuNbs0oYB9wO9CBOBU6RckiZJvWEauxU5ROQ9IoTeqDk8DrgAJE87vEpNHhcWAhB4GHgQWI8kHa8o8aDHcECKfSAodjlLr/hLjc6TTwPqIA0VLX7blUTBjaNC8jCxDlOBlQzrnXKxky3swdx4ECTFgS6M6eo7SIawWYuNTxMh4oaeNYCsLZLBu8EboLdK3QixF9xjLYynltWARBT05uNquXTVEuQ2O2QWUdb8S+e++P7GpVnxDri5Km5MsBBbgrifG83oAoaVe84pkg1jSLHbaE1tBwtcFxbWPe13r607qXatznV1qeTmlRtDP4LDZAMfAXFbij5naP28kAAAAASUVORK5CYII="
          >
        </span>`;
      } else if (isAudioUrl(url, self.event)) {
        // hmm... maybe a 'music' icon or something?
        // code = `<audio controls src="${url}"></audio>`;
      }
      if (code) break;
    }
    if (code)
      html = `<span style='float: left; margin: 0 10px 10px 0;'>${code}</span>${html}`;
  }

  html = `<np-excerpt id="${self.id}" style='display: inline; word-break: break-word;'>${html}</np-excerpt>`;

  return new SafeString(html);
}
