export const RECOMMENDATION_PARTIAL = `{{#if recommendations}}
<ul class="recommendations">
    {{#each recommendations as |rec|}}
    <li class="recommendation">
        <a href="{{rec.url}}" data-recommendation="{{rec.id}}" target="_blank" rel="noopener">
            <div class="recommendation-favicon">
                {{#if rec.favicon}}
                    <img src="{{rec.favicon}}" alt="{{rec.title}}" loading="lazy" onerror="this.style.display='none';">
                {{/if}}
            </div>
            <h5 class="recommendation-title">{{rec.title}}</h5>
            <span class="recommendation-url">{{readable_url rec.url}}</span>
            <p class="recommendation-description">{{rec.description}}</p>
        </a>
    </li>
    {{/each}}
</ul>
{{/if}}
`;