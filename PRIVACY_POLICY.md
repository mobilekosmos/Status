# Privacy Policy

Effective date: 2026-05-05

## Overview

This app ("Status") is an Atlassian Forge app for Confluence that lets users set and view a page status in a macro.

## Data We Process

The app stores the following data as Confluence page properties:

- status value (one of the configured workflow states)
- timestamp for when the status was last changed
- property key information derived from the macro instance identifier

The app does not intentionally collect personal profile data beyond what is already available in Atlassian Cloud context.

## Where Data Is Stored

- Data is stored in the customer Atlassian Confluence Cloud tenant via Confluence page properties.
- No separate external database is used by this app.

## How Data Is Used

Data is used only to:

- render the current status in the macro
- allow users to update status
- display simple status age context (days in current state)

## Data Sharing

This app does not sell personal data.
Data is not shared with third parties except as required for Atlassian Forge platform operation.

## Data Retention

Status data remains in Confluence page properties until it is changed or removed by users or administrators.

## Security

The app uses Forge platform permissions and Confluence API scopes:

- read:page:confluence
- write:page:confluence

## User and Admin Controls

Customer administrators control app installation and removal.
Users with page access can view macro output.

## Contact

For privacy questions, contact the app owner/maintainer for this deployment.
