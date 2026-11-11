---
name: live-code-map
description: Open the Live Code Map for the current Claude Code session — a browser diagram of the classes, methods, properties and method calls Claude adds, modifies or deletes in Java/Kotlin (Spring) code. Use when the user asks to open or show the code map (코드맵 열어줘, 변경 다이어그램, 클래스 다이어그램 보여줘), or to reset the Live Code Map "always/never" choice for this repository (코드맵 다시 물어봐). Do not use it to answer the Code Map question the plugin asks; a hook handles that answer.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/hooks/open.mjs" *)
---

# Live Code Map

Turn on the map for this session and open it in the browser:

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/open.mjs" --session "${CLAUDE_SESSION_ID}" --data "${CLAUDE_PLUGIN_DATA}"
```

From now on, the Java/Kotlin code this session changes is drawn on the map; the current state of the files is the baseline. Give the user the URL the script prints.

If the user wants Live Code Map to ask again in this repository (they earlier chose "Always in this repo" or "Never in this repo"), or the arguments say `reset`, run this instead:

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/open.mjs" --session "${CLAUDE_SESSION_ID}" --data "${CLAUDE_PLUGIN_DATA}" reset
```

If the user wants a specific browser, set `CODE_MAP_BROWSER` to the app name (macOS), for example `CODE_MAP_BROWSER=Arc`.

How to read the map, if the user asks:

- Columns are Spring layers: Controller, Service, Repository, Domain, DTO/other.
- Green = added, blue = modified, red strike-through = deleted, purple pulse = file Claude is about to edit.
- Gray arrows between cards are injection/field dependencies; dashed with a hollow triangle is implements.
- Amber lines between member rows are method calls (green = new call, red dashed = removed call). Callers of a modified method are shown too, so the user can see the impact.
- Clicking a member opens the before/after diff for the current request.
