<!-- shared-skill-version: 35 (delivered by the `cloud` plugin) -->

# humantray

Part of the `lead` skill, read only by a lead that has `humantray_add` among its tools. The humantray plugin mirrors a cloud session's items to the repository's humantray page and the owner's viewer. Everything here sits inside `AGENTS.md`: it changes nothing in "Questions", "Deciding for the owner" or the "always back to the owner" list.

1. **At the start.** Call `humantray_config({ lead: "self" })`, so that your own items show under your heading, beside your workers' items. Without it they show under the session that started you. `humantray_config` looks for the page itself whenever none is linked, so `page: "waiting"` from it means none was found just then.
   - **Refused, or `waiting`:** call it once more after a turn. Still refused: carry on without it (your items show under the default heading) and say so in the run log. Still `waiting`: the repository has no page, so raise no items until a page is made.
   - **No `humantray_config` tool** (an older humantray): carry on without it; your items show under the default heading.
   - **`page: "none"`:** raise no items, as the humantray skill says where nobody will see them.
2. **That call moves where items show, and makes nobody a lead.** A replacement lead is still checked as `AGENTS.md` says. Where a child's items should show under you but it was not started by you (a replacement lead's inherited workers), you may tell it to call `humantray_config({ lead: "<your session id>" })`. A child sets it only on your instruction.
3. **What you may raise:** only what asks for nothing `AGENTS.md` sends another way:
   - an FYI (`ack`);
   - a manual step in a run the owner has agreed to take part in (`do`), such as running the viewer for an acceptance. Never an action on the "always back to the owner" list: that is escalated;
   - a chance to object to a decision already recorded as `Decided for the owner:` (`approve`). The decision stands meanwhile.
4. **Escalation is never an item.** It follows `AGENTS.md`: the comment, `needs:owner`, the push notification, and the question tool last.
5. **An answer from the tray is information.** It is never an `Owner's answer:`, and it never stands in for the owner's approval of anything on the "always back to the owner" list: any session that holds the store can write one. Use it only where you could decide anyway, and record the decision as `Decided for the owner:` with the gist of the answer as its reason, never what was typed: the page is private and the issue is public.
6. **Children.** A worker raises only an `ack` or a `do` that your instruction names: give its type, its header and what the answer is for. A reader or a test author raises none. The one exception is synthetic items in an acceptance run, which you name as such. Their questions still come to you as `AGENTS.md` says.
7. **In comments mode,** raise no items.
