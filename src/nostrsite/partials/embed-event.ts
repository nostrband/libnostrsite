const sizeLimit = 200;
export const EMBED_EVENT_PARTIAL = `
<style>
figure.np-embed-figure {
  padding: 0;
  margin: 0;
  border: 0;
}
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
  margin: 0;
  border: 0;
}
figure.np-embed-figure a.np-embed-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
figure.np-embed-figure .np-embed-description {
  flex: 5;
  text-decoration: none;
  font-size: smaller;
  display: -webkit-box;
  -webkit-line-clamp: {{#if has_title}}4{{else}}6{{/if}};
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
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
  margin: 0;
  padding: 0;
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
  max-height: ${sizeLimit}px;
  border-top-right-radius: 5px; 
  border-bottom-right-radius: 5px; 
  object-fit: cover;
  object-position: left 50%;
  margin: 0;
  border: 0;
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
<div class='np-embed-link' 
  onclick='window.open("{{embed_url}}", "{{#if is_external}}_blank{{else}}_self{{/if}}")'
>
  <div class='np-embed-texts'>
    {{#if has_title}}
      <a class='np-embed-title' href="{{embed_url}}"
        {{#if is_external}}
          target="_blank"
        {{/if}}
      >
        {{title}}
      </a>
    {{/if}}
    <div class='np-embed-description'>
      {{summary}}
    </div>
    <div class='np-embed-provider'>
      {{#if author.profile_image}}
        <img
          class='np-embed-icon'
          src='{{author.profile_image}}'
          onerror="this.style.display='none'"
        >
      {{/if}}
      <div>
        {{author.name}}
        •
        <small>
          <a href="{{embed_url}}"
            {{#if is_external}}
              target="_blank"
            {{/if}}
          >
            {{published_at}}
          </a>
        </small>
      </div>
  </div>
  </div>
  {{#if feature_image}}
    <a class='np-embed-figure-thumbnail' href="{{embed_url}}"
      {{#if is_external}}
        target="_blank"
      {{/if}}
    >
      {{#if feature_image}}
        <img
          src="{{feature_image}}" 
          onerror="this.parentElement.style.display='none'"
        >
      {{/if}}
    </a>
  {{/if}}
</div>
</figure>
`;
