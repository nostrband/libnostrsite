export const ERROR_TEMPLATE = `
{{!< default}}

<main>

<center style='margin: 5rem 1rem'>

<h1 style="margin: 2rem 0">Error! Page not found!</h1>

<p>Please start from the <a href="{{ @site.url }}" style="color: {{ @site.accentColor }}; text-decoration: underline; ">main page</a> or try to use <b>search</b>.</p>

</center>

</main>
`;