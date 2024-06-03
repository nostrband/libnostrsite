// # Raw helper
// Usage: `{{{{raw}}}}...{{{{/raw}}}}`
//
// Returns raw contents unprocessed by handlebars.

export default function raw(options: any) {
  // @ts-ignore
  return options.fn(this);
}
