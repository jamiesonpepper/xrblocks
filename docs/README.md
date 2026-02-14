# XR Blocks Documentation Site

Source code for https://xrblocks.github.io/docs/. \
This website is built using [Docusaurus](https://docusaurus.io/).

## Development

Start the development server for the documentation:

```bash
# In the xrblocks/docs/ directory
npm start
```

This serves the documentation site locally at `http://localhost:3000/` and
watches for changes to the documentation source files.

When viewing docs pages that embed templates or samples, **also** follow the
[development guide](../README.md#development-guide) in the root README to serve
the SDK on port 8080. Both servers can run simultaneously.

## Deployment

The documentation site is automatically deployed to https://xrblocks.github.io/docs/
whenever it is updated in the [google/xrblocks](https://github.com/google/xrblocks) repository.
