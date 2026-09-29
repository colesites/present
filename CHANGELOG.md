# Changelog

All notable desktop changes are documented here. Present follows Semantic Versioning.

## [Unreleased]

## [0.4.5] - 2026-09-29

### Changed

- Choosing media for a background, such as the Bible background in Settings,
  Slides, shows the media folders first, each with a picture from it and how
  many videos and images it holds. Open a folder to choose from it, and
  Folders to go back. The folder with the background in use says so. A search
  looks in the open folder, or in all of them from the folder list. The
  pictures are a proper size to tell apart, with their names under them,
  where the whole library used to be squeezed into thin strips.
- The screen chosen under the operator's preview lists the screens in Screen
  Configuration by the names given there, audience screens and then stage
  screens, the added ones too, where it offered Audience, Media and Worship.
  An audience screen shows its own picture, with its colour and its look; a
  stage screen shows the stage layout chosen for it, as the stage display
  does.
- Looks has a column for each audience screen, by its name in Screen
  Configuration, and one for the NDI output, where it had Screen 1, Stage and
  NDI. Each audience screen shows what its own column allows: its display,
  its NDI, Syphon or SDI output, Multiview and the preview. A screen added
  shows what the Screen shows until its column is changed. The operator's
  toggles for the words, media, background and timer still apply to every
  screen. The Stage column is gone: it changed nothing, and a stage screen
  shows its stage layout.

### Fixed

- Closing the audience output could quit Present. A frame on its way to the
  screen as the window closed was put on a picture that had already been
  taken away, which a playing video, such as one in a Screen Composer region
  or behind a passage, made all but certain. Closing a screen could also,
  more rarely, freeze the app. Both are fixed.

## [0.4.4] - 2026-09-27

### Added

- Present updates itself. "Check for Updates…" is under Settings in the
  Present menu on a Mac and in Help on Windows. A newer version downloads in
  the background, and the item becomes "Restart to Update to" that version.
  It never restarts on its own, and asks first while the audience screen is
  open. This version has to be installed by hand once; the ones after it
  arrive this way.
- Screen configuration, as ProPresenter has it. Screens ▸ Configure Screens…
  (⌥⌘1) opens Screens & sound with two groups: Audience, which starts with
  one screen, and Stage, which starts with the media stage and the worship
  stage. The + beside each adds a screen on a connected display, as an NDI
  source, or as a placeholder with no output yet. Added audience screens go on
  and off with the audience output.
  - A screen is Single, Mirror (the same picture on several outputs),
    Grouped (one picture cut across a grid of outputs, like a wall of TVs) or
    Edge blend (one wide picture across projectors side by side, the overlap
    faded with a linear, cubic or quadratic curve).
  - Each output's Output menu is grouped as ProPresenter's is: the connected
    displays, then New NDI (720p59.94 to 4Kp60), New Syphon and New
    Placeholder (1280 × 720, 1920 × 1080 or 3840 × 2160), each with a Custom
    Size, and on a Mac the SDI devices and their video modes.
  - Its Output Target is Full, one part of the output split 2 × 1, 1 × 2,
    2 × 2, 3 × 1 or 3 × 3, a picture of a common size at its top left, or
    Custom (any rectangle, in its pixels, for an LED processor or a framed
    picture). Each output has its own Color (brightness, contrast,
    saturation, hue, black level) and Corner Pin tabs.
  - Each screen can be renamed and given a screen color. Identify shows each
    screen's name, or its display's, on the screen itself.
  - The connected displays are drawn where the computer arranges them; click
    one to send an output there. Display settings opens the computer's own.
  - The NDI size is now with the NDI settings, under Connections.
  - On a Mac, an audience screen can also be sent to Syphon, for OBS,
    Resolume or another app on the same Mac, or out of SDI through a
    Blackmagic DeckLink or UltraStudio device (1080p, 1080i, 720p or 2160p,
    at the usual rates). SDI needs Blackmagic Desktop Video installed, and
    says so if it isn't. An NDI output is sent at its mode's rate, 29.97 and
    interlaced ones included. A sent output that can't start says why under
    its output.
- Stage layouts, made as you like. Screens ▸ Edit Stage Layouts… opens the
  stage editor. A layout is built from objects placed anywhere on it: text,
  shapes, the current and next slide's words, the current slide itself, the
  section and the next section, the clock, the timer and the timer's name.
  Each is moved and sized by dragging, and given its own font, colour, fill,
  border and caption. Start from a blank layout or from one of the templates,
  and duplicate, rename or delete layouts. The media stage and the worship
  stage start with layouts that look as they did, and can be changed or put
  back as they started. Any stage screen, the new ones too, shows the layout
  chosen for it in Screen Configuration.
- Multiview, for the media desk. Move the mouse on the media stage screen and
  choose Open Multiview, or use Screens ▸ Multiview, to see every screen at
  once, live, as a wall of TVs: the audience picture and each stage screen's
  layout, each labelled and edged green while on, with the clock and the
  timer above them. Choose screens picks the ones shown and how many go on a
  page, any number or all of them; the wall is laid out to make them as
  large as they can be, and more screens go on further pages, turned with
  Prev and Next, the page numbers or the arrow keys. Back to stage, or Esc,
  returns to the stage screen.
- The timer's clock can have a background: none, black, dimmed or a color.
  With the banner on, the name's banner goes at the top or the bottom.
- The Screen Composer lists its regions as layers, the top one first, to
  choose any of them and put it above or below another.
- When the live timer runs out and no other timer follows it, the screens
  show a blinking red TIME UP instead of 00:00:00: the audience screen, the
  stage screen, the preview and a composer countdown region. The message, its
  colour and the blinking are chosen in Settings, Timer, under When time is
  up, and it can be turned off there. Playing the timer again, resetting it or
  changing its time takes the message away.

### Fixed

- A change in Settings, such as the Bible font size, reached the operator
  window only after something else was done there. It now applies at once.
  The song settings are for new songs and lyrics made into slides; a song
  already made keeps its own fonts.
- The Screen Composer was heavy on screen. Each region's video frame was
  converted a pixel at a time and drawn through a slow scaler, and the whole
  picture was drawn again sixty times a second whether or not a video had a
  new frame. Frames are now copied into their regions in one pass across the
  processor's cores, at the region's own size, and the picture is drawn again
  only when a video moves on. A composed screen with two playing videos went
  from about 72 ms a frame to about 10 ms. The composer shows stills of its
  videos rather than playing each one.
- Media chosen for a region in the Screen Composer did not reach the screen,
  or only when the operator window was next clicked. Changes now reach it at
  once. The composer's regions are filled from the operator window's own
  panels while a region is selected, rather than from a second media library
  in its settings.
- A countdown in the Screen Composer always had a dark shade behind it. A
  region's background is now chosen: none, black, dark or a color.
- With Settings open, turning a stage screen off from the Screens menu turned
  it straight back on, and the menu's ticks for the stage screens went off.
- Help no longer offers Download the Latest Version, now that Present updates
  itself.
- A desktop could be signed out when the website took more than three
  seconds to check its own signing key: it fell back to the browser session
  that started the sign-in, which may have ended long before. It now keeps
  the session and tries again, and it never signs out on the computer's own
  clock.

## [0.4.3] - 2026-09-27

### Fixed

- Nothing could be reordered by dragging: a service's items and groups, a
  template's, the slide grid, the editor's slides and timers, nor a library
  item dragged into a service. Tauri's file-drop handler took every drag over
  the window, so the page never saw where it was dropped. The windows are now
  built without it.
- A song with a theme was slow: slides took a long time to change,
  transitions did not run and a background video hung. While any video
  played, the slide was drawn again about ten times a second, and a themed
  slide took a tenth of a second to draw. It is now drawn only when it
  changes, in about half the time, and the slide grid no longer redraws every
  slide on each click.
- The Screen Composer did not reach the screen. Go Live now puts the layout
  on screen, a region's media is chosen in the composer, and the audience
  screen draws each region where it was placed, plays its video, shows its
  slide and shows the running countdown.

## [0.4.2] - 2026-09-26

### Changed

- The keyboard's play and pause keys, and the Now Playing controls, play and
  pause the video on every screen, as the player's own controls do.

### Fixed

- The preview could go blank after a visit to Edit or Browser, and stay on a
  black frame.
- A video playing when the computer went to sleep was stopped on every screen
  when it woke. WebKit pauses the player during sleep, and that was taken as
  the operator pausing it. A pause now counts only when the operator made it,
  and any other pause while a video is meant to be playing is undone.

## [0.4.1] - 2026-09-26

Themes, a song agent, and a Settings window laid out again.

### Added

- Themes: a Themes panel with built-in themes, Pro and Power themes, and your
  own. A theme is designed on the slide itself, dragging and resizing the words
  and the box behind them, with the font, weight, spacing, line height,
  outline, shadow, gradients and colour mixes. A background can be a colour, a
  gradient, a mix, or an image or video from the media library. A built-in
  theme can be changed as a copy.
- A song agent. While it is on, it listens to the singing, moves the song on
  screen along slide by slide, and says when the band starts another song from
  the library, then waits for the operator to show it. Included with Pro and
  Power.
- An Agent page in Settings, in place of Speech to Search: the language and
  microphone both agents listen with, whether a passage the Bible agent hears
  goes straight on screen or waits in the Bible tab, whether it is added to the
  service, the "next verse" and "previous verse" commands, and whether the song
  agent follows the song and suggests others. Each starts as the agent behaved
  before.
- The editor's slide list shows each slide as it will look, and its sidebar is
  shorter, in tabs.
- A passage in a service opens in the Bible tab when it is chosen, and
  Previous and Next step through the verses around it.
- Every control in the menu bar: File, Edit, View, Presentation (slides,
  items, layers, freeze, media playback and the timer), Screens, Window and
  Help.
- Workspace invitations. An admin invites an email address, and that person
  accepts from the account menu or the website. Anyone who knew a workspace's
  id could join it before.
- Each plan, Free, Pro and Power, gets what it includes, from AI minutes to
  members to themes.

### Changed

- Settings has five pages: Screens & sound, Agent, Slides, Timer and
  Connections. Video sound is with the screens, the song and Bible fonts sit
  beside a preview of a slide, and the Bible background is chosen from the
  media picker.
- Slide text draws its outline, shadow, letter spacing, line height, underline
  and gradient fills on every screen, the same in the slide grid, the preview
  and the audience output.
- Every weight of every installed font can be chosen, not only Regular.
- The app calls itself presentation software, for churches, conferences and
  live events.
- Services and libraries are there when the window opens, rather than filling
  in a second or more later, and a church's workspace syncs as soon as its
  organisation is known after signing in.

### Fixed

- Video skipped and transitions did not run on the audience screen. Video now
  plays at a steady rate there, and transitions run as they do in the preview.
- The preview showed the slide before the live one whenever a transition was
  set.
- A theme's box and background moved with the words during a transition.
- Editing a song's lyrics while it was on screen left the old words on the
  outputs until the slide was chosen again, and the slide grid lost its place.
- A scrolling message stuttered, and the preview showed it twice, with a faint
  copy behind it.
- YouTube props showed "Error 153" in the installed app.
- Worship stage videos froze on their first frame after switching videos or
  showing media again.
- The chosen microphone was forgotten when Settings opened.
- The font list was cut off at the edge of its panel.
- The Windows build failed at its last step, unable to find FFmpeg's import
  libraries.
- A band of empty space sat under the last row of slides.

## [0.4.0] - 2026-09-24

Present's core is now Rust. The Electron main process is gone (tagged
`electron-final`) and the audience screen is drawn rather than rendered.

### Added

- Transitions: a layer-aware engine with 108 presets built from primitives, a
  picker, and still thumbnails that animate on hover — drawn by the engine that
  will run the transition in front of the congregation, not imitated in CSS.
- A listening scripture agent. What the preacher says goes to a model, and a
  reference it resolves to an installed book is projected. There are no
  suggestions to confirm: nobody running a service has a hand free.
- Archive services instead of deleting them, and act on several at once.
  Archiving keeps everything in the service and only takes it out of the list.
- Messages can scroll across the screen, at a speed the operator sets.
- Several media folders can be added in one pass.
- Looks can be deleted. The last one cannot: every destination reads its layers
  from one.

### Changed

- Video is FFmpeg 9.0.1, built from source under LGPL, with VideoToolbox
  hardware decode. Every bundle carries FFmpeg's source, as the licence asks.
- Slides, media, messages, props and the timer are composited into one frame,
  which the audience surface, NDI and every preview all show. The preview is
  now the picture the congregation sees rather than an approximation of it.
- The offline store is SQLite, written through from the renderer, with a queue
  for changes made with no network.
- Timer sizes are taken against a 1080-tall screen and scaled to the frame, so
  the same settings look the same on a preview, a projector and a 4K wall.
- A signed build declares what it actually uses — camera and capture devices,
  the local network for NDI, and the folders media lives in — and carries the
  entitlements the hardened runtime needs for the microphone, capture devices
  and the bundled NDI runtime.

### Fixed

- A packaged build could not draw its own preview frames: the content policy
  named the media and NDI schemes but not the two the previews use, so the
  audience preview was empty and every transition tile was blank.
- Clicking a video quit the app. The media protocol answered WebKit from a
  background thread, and a request cancelled in between — which a video does
  constantly — raised an exception across a frame that cannot unwind.
- A YouTube prop rendered nothing, on every screen: it used a tag that exists
  only in Electron.
- The timer name, and the size chosen for it, appeared only when its banner was
  also on.
- A message was drawn at roughly twice its intended size, and the colour behind
  it was measured from the unscaled text, so it did not cover it.
- Signing in during development reached whichever Present was installed rather
  than the one being worked on.
- A development build shares neither its data nor its session with an installed
  one. It had been reading the installed app's services and sending them to a
  deployment that has never seen them, which failed every org-scoped query and
  left the window black.
- A failed query no longer blanks the window: the app has an error boundary.
  The audience screen was never affected — it is drawn by the core.

## [0.3.8] - 2026-09-05

### Fixed

- Reordering groups and standalone items did nothing in a service created from a template. The sidebar numbered its rows from the service's stored layout while the move resolved that number against a rebuilt one, so a drop landed on the wrong row or was rejected outright.
- Dropping an item onto the row directly below it left the order unchanged; only dropping past that row moved anything.
- Select menus, dropdowns, context menus, and tooltips opened behind a modal dialog instead of above it, which made the category picker in the Edit library item and Create flow dialogs unusable.
- Idle CPU stayed high with the timer panel open: the tick rewrote timer state once a second even with no timer running, re-rendering every consumer and re-persisting to local storage each time.

## [0.3.7] - 2026-09-05

### Added

- Drag a group to a new position inside a service. The rearrangement applies to that service alone and never changes the template it was created from.

### Fixed

- Dropping a service item on a row boundary placed it one slot too far when dragged downwards.

## [0.3.0] - 2026-06-22

### Added

- Persisted exact-phrase and broad-ranked modes for Bible text search.
- A fast in-memory Bible verse index with ranked word, phrase, and partial-token matching.
- A stacked speech-search cue deck with up to five ranked accept/decline cards.
- Live-output state on Bible search results and accepted speech cards.

### Changed

- Consolidated speech reference detection and verse-text matching into one deduplicated candidate queue.

## [0.2.4] - 2026-06-22

### Fixed

- Prevent transient token refresh and Convex reconnect failures from signing desktop users out.
- Honor forced access-token refreshes and preserve the rotated desktop session expiry.
- Preserve the editor slide-list scroll position across draft updates and remounts.

### Added

- Automated auth refresh policy tests and CI quality gates.
- Redacted local crash and error diagnostics with bounded log rotation.
- Tag/package/changelog validation for desktop releases.

## [0.2.3] - 2026-06-02

### Added

- Existing desktop feature baseline before the `0.2.4` reliability patch.
