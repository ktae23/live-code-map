---
name: code-map
description: Open the live Code Map for the current Claude Code session — a browser diagram of the classes, methods, properties and method calls Claude has added, modified or deleted in Java/Kotlin (Spring) code. Use when the user asks to open or show the code map, 코드맵 열어줘, 변경 다이어그램, 클래스 다이어그램 보여줘, or wants to see the structure of the changes visually.
---

# Code Map

Open the map for this session:

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/open.mjs"
```

The script starts the local server if it is not running, picks the most recently active Claude session in the current project, opens it in the browser, and prints the URL. Give the user that URL.

If the user wants a specific browser, set `CODE_MAP_BROWSER` to the app name (macOS), for example `CODE_MAP_BROWSER=Aside node "${CLAUDE_PLUGIN_ROOT}/hooks/open.mjs"`.

How to read the map, if the user asks:

- Columns are Spring layers: Controller, Service, Repository, Domain, DTO/other.
- Green = added, blue = modified, red strike-through = deleted, purple pulse = file Claude is about to edit.
- Gray arrows between cards are injection/field dependencies; dashed with a hollow triangle is implements.
- Amber lines between member rows are method calls (green = new call, red dashed = removed call). Callers of a modified method are shown too, so the user can see the impact.
- Clicking a member opens the before/after diff for the current request.
