const sizeLimit = 200;
export const EMBED_URL_PARTIAL = `
<style>
  figure.np-embed-figure .np-embed-link {
    display: flex;
    justify-content: space-between;
    padding: 0;
    margin: 10px 0;
    border: 1px solid #bbb;
    border-radius: 5px;
    text-decoration: none;
    cursor: pointer;
  }
  figure.np-embed-figure .np-embed-texts {
    display: flex;
    flex-direction: column;
    flex: 5;
    padding: 20px;
    width: 100%;
  }
  figure.np-embed-figure a.np-embed-title {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  figure.np-embed-figure .np-embed-description {
    flex: 5;
    text-decoration: none;
    font-size: smaller;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  figure.np-embed-figure .np-embed-provider {
    display: flex;
    gap: 10px;
    justify-content: flex-start;
    align-items: center;
    font-size: smaller;
    margin-top: 5px;
  }
  figure.np-embed-figure img.np-embed-icon {
    width: 24px;
    height: 24px;
    border-radius: 3px;
  }
  figure.np-embed-figure .np-embed-url {
    flex: 5;
    opacity: 0.7;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  figure.np-embed-figure .np-embed-figure-thumbnail {
    flex-shrink: 2;
    max-width: 40%;
    min-height: ${sizeLimit}px;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden!important;
  }
  figure.np-embed-figure .np-embed-figure-thumbnail img {
    flex-shrink: 0;
    min-width: ${sizeLimit}px;
    min-height: 100%;
    max-height: 100%;
    border-top-right-radius: 5px; 
    border-bottom-right-radius: 5px; 
    object-fit: cover;
    object-position: left 50%;
  }
  @media screen and (max-width: 600px) {
    figure.np-embed-figure .np-embed-link {
      flex-direction: column-reverse;
    }
    figure.np-embed-figure .np-embed-figure-thumbnail {
      max-width: 100%;
      width: 100%;
      min-height: 0;
    }
    figure.np-embed-figure .np-embed-figure-thumbnail img {
      width: 100%;
      min-height: ${sizeLimit}px;
      max-height: ${sizeLimit * 2}px;
      object-position: 50% top;
      border-top-right-radius: 5px; 
      border-top-left-radius: 5px; 
      border-bottom-right-radius: 0; 
    }
  }
</style>
<figure class='np-embed-figure'>
  <div class='np-embed-link' onclick='window.open("{{embed_url}}", "_blank")'>
    <div class='np-embed-texts'>
      <a class='np-embed-title' href="{{embed_url}}" target="_blank">
        {{title}}
      </a>
      <div class='np-embed-description'>
        {{description}}
      </div>
      <div class='np-embed-provider'>
        {{#if icon}}
          <img
            class='np-embed-icon'
            src='{{icon}}'
            onerror="this.src='{{icon_nocors}}'; this.onerror=() => { this.style.display='none' }"
          >
        {{/if}}
        <div>
          {{provider_name}}
          {{#if author_name}}
            • {{author_name}}
          {{/if}}
        </div>
        {{#if only_path}}
          <div class='np-embed-url'>
            {{url_path}}
          </div>
        {{/if}}
    </div>
    </div>
    {{#if show_thumbnail}}
      <a class='np-embed-figure-thumbnail' href="{{embed_url}}" target="_blank">
        <img
          src="{{thumbnail_url}}" 
          onerror="this.src='{{thumbnail_url_nocors}}'; this.onerror=() => { this.parentElement.style.display='none' }"
        >
      </a>
    {{/if}}
  </div>
</figure>`;
