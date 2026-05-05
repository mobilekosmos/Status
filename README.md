# Status Macro (Forge, Confluence)

This project is an Atlassian Forge UI Kit Confluence macro that stores and displays a page status as a lozenge.

Users click the lozenge to open a compact picker and select one of these states:

- READY FOR ACCEPTANCE TEST
- IN ACCEPTANCE TEST
- NOT ACCEPTED
- ACCEPTED FOR RELEASE

The selected value is saved as a Confluence page property, scoped per macro instance.

## What Is Implemented

- UI Kit frontend macro in [src/frontend/index.jsx](src/frontend/index.jsx)
- Backend resolver in [src/resolvers/index.js](src/resolvers/index.js)
- Manifest and scopes in [manifest.yml](manifest.yml)
- Uses Confluence v2 page properties endpoints
- Uses app identity (`asApp`) to avoid per-user consent prompts

## Prerequisites

1. Node.js LTS
2. Forge CLI installed and authenticated
3. Access to an Atlassian Cloud site with Confluence

Reference: [Set up Forge](https://developer.atlassian.com/platform/forge/set-up-forge/)

## Project Structure

- [manifest.yml](manifest.yml): Forge modules, resources, runtime, scopes
- [src/frontend/index.jsx](src/frontend/index.jsx): Macro UI and interactions
- [src/resolvers/index.js](src/resolvers/index.js): Status read/write logic

## Permissions (Scopes)

Current scopes in [manifest.yml](manifest.yml):

- `read:page:confluence`
- `write:page:confluence`

These are required by the Confluence v2 page properties endpoints used by this app.

## Development Workflow

Run from the app root directory:

```bash
forge lint
forge deploy --non-interactive -e development
forge install --non-interactive --site <your-site>.atlassian.net --product confluence --environment development
```

If scopes change, upgrade the installation:

```bash
forge install --non-interactive --upgrade --site <your-site>.atlassian.net --product confluence --environment development
```

## Production Deployment

Deploy:

```bash
forge deploy --non-interactive -e production
```

Install to a site (first time):

```bash
forge install --non-interactive --site <your-site>.atlassian.net --product confluence --environment production
```

Upgrade an existing production install (for example after scope changes):

```bash
forge install --non-interactive --upgrade --site <your-site>.atlassian.net --product confluence --environment production
```

## Installing On A Site Where You Are Not Admin

If `forge install` fails with insufficient permissions:

1. Open Atlassian developer console for this app.
2. Go to Distribution.
3. Generate/copy the installation link.
4. Send the link to a site admin and ask them to install the production app for Confluence.

Direct app distribution page:

https://developer.atlassian.com/console/myapps/0110dab8-0a9e-43a9-ba8b-84ec0c93fc0a/distribution

## Notes

- Development and production are separate Forge environments.
- Existing macro instances inserted from one environment do not automatically migrate state to another environment.
- Always run `forge lint` before deploy.

