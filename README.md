# ChangeBot Monitor

This repository contains the monitoring code for [ChangeBot](https://github.com/phlgr/changebot).

Get started at [phlgr/changebot](https://github.com/phlgr/changebot).

## What is this?

This repository monitors websites for changes and sends notifications via ntfy.sh when changes are detected. It's powered by GitHub Actions and Bun.

## Local Development

To develop and test locally:

1. Create a `.changebotrc.yml` file with your monitoring configuration
2. Create a `.env` file with any required environment variables (e.g., API keys, notification settings)
3. Run `bun start` to execute the monitor

The monitor will check configured websites, detect changes, and send notifications as configured.
