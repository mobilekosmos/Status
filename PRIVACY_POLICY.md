# Privacy Policy

Effective date: 2026-05-05

## Overview

This app ("Status") is an Atlassian Forge app for Confluence that lets users set and view a status in a macro on pages and blog posts.

## Data We Process

The app stores the following data as Confluence content properties of the page or blog post that contains the macro:

- status value (one of the configured workflow states)
- timestamp for when the status was last changed
- property key information derived from the macro instance identifier

The app does not intentionally collect personal profile data beyond what is already available in Atlassian Cloud context.

To check whether a user may view or change a status, the app sends that user's Atlassian account ID to Confluence's permission check. The account ID is used only for that request and is not stored.

## Where Data Is Stored

- Data is stored in the customer Atlassian Confluence Cloud tenant as content properties of pages and blog posts.
- No separate external database is used by this app.
- If a request to Confluence fails, the HTTP status and Confluence's error message are written to the app's Forge logs, which Atlassian hosts.

## How Data Is Used

Data is used only to:

- render the current status in the macro
- allow users to update status
- display simple status age context (days in current state)

## Data Sharing

This app does not sell personal data.
Data is not shared with third parties except as required for Atlassian Forge platform operation.

## Data Retention

Status data remains in Confluence content properties until it is changed or removed by users or administrators.

## Security

The app uses Forge platform permissions and Confluence API scopes:

- read:page:confluence
- write:page:confluence
- read:content.permission:confluence

## User and Admin Controls

Customer administrators control app installation and removal.
Users with page access can view macro output.

## Contact

For privacy questions, contact the app owner/maintainer for this deployment.
