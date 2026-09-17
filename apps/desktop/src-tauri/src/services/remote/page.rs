//! The page the phone shows.
//!
//! One file, no build step, no network beyond the church's own: a phone in a
//! hall with no signal has to be able to open this. Big targets, because it is
//! used one-handed, in the dark, by somebody watching the stage and not the
//! screen.

/// The page, with the token written into it so every request carries one.
pub fn html(token: &str) -> String {
    PAGE.replace("__TOKEN__", token)
}

const PAGE: &str = r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0d14">
<title>Present remote</title>
<style>
  :root { color-scheme: dark; --edge: #23283a; --ink: #e8eaf2; --dim: #9aa0b5; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; min-height: 100dvh; display: flex; flex-direction: column; gap: 10px;
    padding: max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom));
    background: #0b0d14; color: var(--ink);
    font: 16px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    user-select: none;
  }
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h1 { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); margin: 0; font-weight: 600; }
  #link { font-size: 12px; color: var(--dim); }
  #link.off { color: #ff6b6b; }
  #slide {
    flex: 1; min-height: 88px; display: flex; align-items: center; justify-content: center;
    padding: 14px; text-align: center; white-space: pre-wrap; overflow: hidden;
    border: 1px solid var(--edge); border-radius: 14px; background: #11141f;
    font-size: 19px;
  }
  #slide.empty { color: var(--dim); font-size: 14px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .row.three { grid-template-columns: 1fr 1fr 1fr; }
  button {
    font: inherit; color: var(--ink); background: #171b29; border: 1px solid var(--edge);
    border-radius: 14px; padding: 18px 10px; min-height: 64px; font-weight: 600;
  }
  button:active { background: #232a3f; transform: scale(.985); }
  button.big { min-height: 96px; font-size: 18px; }
  button.small { min-height: 52px; font-size: 14px; font-weight: 500; color: var(--dim); }
</style>
</head>
<body>
  <header>
    <h1>Present</h1>
    <span id="link">connecting…</span>
  </header>

  <div id="slide" class="empty">Nothing on the screen</div>

  <div class="row">
    <button class="big" data-action="previousSlide" aria-label="Previous slide">◀ Slide</button>
    <button class="big" data-action="nextSlide" aria-label="Next slide">Slide ▶</button>
  </div>
  <div class="row">
    <button data-action="previousItem">◀ Item</button>
    <button data-action="nextItem">Item ▶</button>
  </div>
  <div class="row three">
    <button class="small" data-action="text">Words</button>
    <button class="small" data-action="media">Media</button>
    <button class="small" data-action="freeze">Freeze</button>
  </div>

<script>
  const token = "__TOKEN__";
  const link = document.getElementById("link");
  const slide = document.getElementById("slide");

  function show(state) {
    const text = (state && state.slideText) || "";
    slide.textContent = text || "Nothing on the screen";
    slide.classList.toggle("empty", !text);
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    // A switch action toggles; the rest carry nothing.
    const body = ["text", "media", "background", "freeze"].includes(action)
      ? { action, to: "toggle" }
      : { action };
    if (navigator.vibrate) navigator.vibrate(8);
    fetch("/api/action?t=" + token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  });

  // The live view, and the reconnection a phone needs after it sleeps.
  let socket = null;
  function connect() {
    socket = new WebSocket(`ws://${location.host}/ws?t=${token}`);
    socket.onopen = () => { link.textContent = "connected"; link.classList.remove("off"); };
    socket.onmessage = (event) => {
      try { show(JSON.parse(event.data)); } catch {}
    };
    socket.onclose = () => {
      link.textContent = "reconnecting…";
      link.classList.add("off");
      setTimeout(connect, 1000);
    };
    socket.onerror = () => socket.close();
  }
  connect();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && (!socket || socket.readyState > 1)) connect();
  });
</script>
</body>
</html>
"##;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_carries_the_token_and_nothing_from_the_internet() {
        let page = html("abc123");
        assert!(page.contains(r#"const token = "abc123""#));
        assert!(!page.contains("__TOKEN__"));
        // A hall with no signal still has to be able to use this.
        assert!(!page.contains("http://"), "no external resources");
        assert!(!page.contains("https://"), "no external resources");
    }

    #[test]
    fn every_button_asks_for_an_action_the_core_knows() {
        use crate::services::control::Action;

        let page = html("t");
        for action in [
            "nextSlide",
            "previousSlide",
            "nextItem",
            "previousItem",
            "text",
            "media",
            "freeze",
        ] {
            assert!(
                page.contains(&format!(r#"data-action="{action}""#)),
                "{action} is on the page"
            );
            let json = match action {
                "text" | "media" | "freeze" => {
                    format!(r#"{{"action":"{action}","to":"toggle"}}"#)
                }
                _ => format!(r#"{{"action":"{action}"}}"#),
            };
            serde_json::from_str::<Action>(&json)
                .unwrap_or_else(|error| panic!("the core does not know {action}: {error}"));
        }
    }
}
