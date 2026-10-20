# DYS-015 Report — Production Task graph and Generation Runs

**Status:** Planned; specification drafted.

Production guidance should be backed by project data, not only Shot-level checkboxes. Production Tasks define intended work, inputs, dependencies and outputs. Generation Runs preserve each attempt's effective prompt, model/settings, input-reference snapshot, result and errors. Retries preserve prior outputs.

The workflow must support copying prompts and manually importing results now, and provider adapters later. No task/run runtime implementation or tests are claimed in this update.
